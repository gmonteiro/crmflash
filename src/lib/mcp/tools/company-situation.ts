import { z } from "zod"
import { fetchPipelineSnapshot } from "@/lib/pipeline/snapshot"
import { colById, daysSinceClientEvent, daysInCurrentStage } from "@/lib/pipeline/stages"
import type { McpTool } from "../registry"

const input = z.object({
  company_id: z.string().uuid().describe("Id da empresa. Use search para descobrir."),
})

export const companySituation: McpTool<typeof input> = {
  name: "company_situation",
  description:
    "Dossiê completo de UMA empresa: estágio atual, há quantos dias sem evento do " +
    "cliente, há quantos dias no estágio, timeline recente, próximos passos pendentes, " +
    "sinais de compromisso capturados, champion, comprador econômico, hipótese de dor " +
    "e pessoas vinculadas. Use antes de registrar qualquer coisa sobre uma empresa.",
  input,
  async handler({ supabase }, { company_id }) {
    const snap = await fetchPipelineSnapshot(supabase, {
      includeActivities: true,
      activityDays: 90,
      includePeople: true,
    })

    const company = snap.companies.find((c) => c.id === company_id)
    if (!company) throw new Error(`Empresa ${company_id} não está no board do pipeline.`)

    const stage = colById(snap.columns).get(company.kanban_column_id) ?? null

    const { data: timeline } = await supabase
      .from("company_activities")
      .select("type, title, description, date")
      .eq("company_id", company_id)
      .order("date", { ascending: false })
      .limit(20)

    return {
      company_id: company.id,
      name: company.name,
      stage: stage?.title ?? null,
      days_since_client_event: daysSinceClientEvent(company, snap.now),
      days_in_current_stage: daysInCurrentStage(
        company.id,
        company.kanban_column_id,
        snap.events,
        snap.now
      ),
      champion: company.champion_name,
      economic_buyer: company.economic_buyer_name,
      pain_hypothesis: company.pain_hypothesis,
      signals: snap.signals
        .filter((s) => s.company_id === company_id)
        .map((s) => ({ type: s.signal_type, captured_at: s.captured_at })),
      pending_next_steps: snap.nextSteps
        .filter((s) => s.company_id === company_id)
        .map((s) => ({ id: s.id, title: s.title, due_date: s.due_date })),
      people: snap.people
        .filter((p) => p.company_id === company_id)
        .map((p) => ({ id: p.id, name: p.full_name })),
      timeline: timeline ?? [],
    }
  },
}
