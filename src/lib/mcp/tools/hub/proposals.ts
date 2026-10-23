import { z } from "zod"
import { decideInference } from "@/lib/hub/decisions"
import { applyEffect } from "@/lib/pipeline/effects"
import { fetchPipelineSnapshot } from "@/lib/pipeline/snapshot"
import type { McpTool } from "../../registry"

const decideInput = z.object({
  inference_id: z.string().uuid(),
  decision: z.enum(["accept", "reject"]),
})

export const decideProposal: McpTool<typeof decideInput> = {
  name: "decide_proposal",
  description:
    "Aceita ou recusa uma proposta da IA (sugestão de estágio; troca de champion / " +
    "comprador / dor já preenchidos; ou próximo passo que a IA viu numa reunião que você " +
    "já revisou no TranscriptionApp — aceitar cria o passo). Aceitar uma sugestão de estágio MOVE a conta — " +
    "confirme com a pessoa antes. Prefira answer_with_action quando a proposta aparecer " +
    "em whats_stuck.",
  input: decideInput,
  async handler({ supabase, workspaceId, userId }, args) {
    const { data: inf } = await supabase
      .from("inferences")
      .select("id, company_id, field, value, status")
      .eq("id", args.inference_id)
      .maybeSingle()
    if (!inf) throw new Error("Proposta não encontrada.")

    if (args.decision === "accept" && inf.field === "stage_suggestion" && inf.status === "proposed") {
      const target = String((inf.value as { target_stage?: string } | null)?.target_stage ?? "")
      const snap = await fetchPipelineSnapshot(supabase)
      await applyEffect(
        supabase,
        { workspaceId, userId, companyId: inf.company_id, snapshot: snap },
        { kind: "move_stage", target: "title", title: target }
      )
    }
    const out = await decideInference(supabase, { workspaceId, userId }, args.inference_id, args.decision)
    if (!out.ok) throw new Error(out.detail)
    return out
  },
}

const explainInput = z.object({
  company_id: z.string().uuid(),
  field: z
    .string()
    .nullable()
    .default(null)
    .describe("champion, economic_buyer, pain_hypothesis, stage_suggestion, signal:<tipo>... Sem valor, tudo."),
})

export const explain: McpTool<typeof explainInput> = {
  name: "explain",
  description:
    "Por que o CRM acha isso? Devolve as conclusões da IA sobre a empresa com a citação " +
    "literal da reunião de onde saíram, o link para a gravação e se foram aplicadas, " +
    "propostas ou recusadas.",
  input: explainInput,
  async handler({ supabase }, { company_id, field }) {
    let q = supabase
      .from("inferences")
      .select("id, field, value, evidence, status, model, prompt_version, created_at, decided_at")
      .eq("company_id", company_id)
      .neq("field", "summary")
      .order("created_at", { ascending: false })
      .limit(50)
    if (field) q = q.eq("field", field)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return { company_id, inferences: data ?? [] }
  },
}
