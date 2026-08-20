import { differenceInCalendarDays, parseISO, format } from "date-fns"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getCopilotProvider, hasCopilotApiKey } from "@/lib/copilot"
import type { CopilotCompanyContext } from "@/lib/copilot"
import { verifyCsrfOrigin } from "@/lib/utils"
import { rateLimit, rateLimitKey } from "@/lib/rate-limit"
import { copilotInterpretRequestSchema, copilotUpdateProposalSchema } from "@/lib/validators"
import { STAGE_EXIT_CRITERIA } from "@/lib/constants"
import type { CommitmentSignalType } from "@/types/database"

export const maxDuration = 30

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

export async function POST(request: Request) {
  if (!verifyCsrfOrigin(request)) {
    return jsonResponse({ error: "Forbidden" }, 403)
  }

  const rl = rateLimit(rateLimitKey(request, "copilot-interpret"), {
    limit: 20,
    windowMs: 60_000,
  })
  if (!rl.success) {
    return jsonResponse({ error: "Too many requests" }, 429)
  }

  if (!hasCopilotApiKey()) {
    return jsonResponse({ error: "API key not configured." }, 500)
  }

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  const parsed = copilotInterpretRequestSchema.safeParse(await request.json())
  if (!parsed.success) {
    return jsonResponse(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      400
    )
  }
  const { companyId, questionTitle, narration } = parsed.data

  // O contexto é montado aqui, do banco, e nunca aceito do cliente — senão seria
  // possível forjar o estágio e induzir um avanço indevido.
  const [companyRes, columnsRes, signalsRes, stepsRes, activitiesRes] = await Promise.all([
    supabase
      .from("companies")
      .select(
        "id, name, kanban_column_id, last_client_event_at, champion_name, economic_buyer_name, pain_hypothesis"
      )
      .eq("id", companyId)
      .eq("user_id", user.id)
      .single(),
    supabase.from("kanban_columns").select("id, title, position").order("position"),
    supabase
      .from("company_commitment_signals")
      .select("signal_type")
      .eq("company_id", companyId)
      .eq("user_id", user.id),
    supabase
      .from("company_next_steps")
      .select("title, due_date")
      .eq("company_id", companyId)
      .eq("user_id", user.id)
      .eq("status", "pending")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(10),
    supabase
      .from("company_activities")
      .select("date, type, title")
      .eq("company_id", companyId)
      .eq("user_id", user.id)
      .order("date", { ascending: false })
      .limit(5),
  ])

  const company = companyRes.data
  if (!company) {
    return jsonResponse({ error: "Company not found" }, 404)
  }

  const columns = (columnsRes.data ?? []) as { id: string; title: string; position: number }[]
  const stage = columns.find((c) => c.id === company.kanban_column_id) ?? null
  const allStageTitles = columns.map((c) => c.title)
  const capturedSignals = ((signalsRes.data ?? []) as { signal_type: CommitmentSignalType }[]).map(
    (s) => s.signal_type
  )

  const ctx: CopilotCompanyContext = {
    name: company.name,
    stageTitle: stage?.title ?? null,
    stageExitCriteria: stage ? (STAGE_EXIT_CRITERIA[stage.title] ?? null) : null,
    allStageTitles,
    daysSinceClientEvent: company.last_client_event_at
      ? differenceInCalendarDays(new Date(), parseISO(company.last_client_event_at))
      : null,
    championName: company.champion_name,
    economicBuyerName: company.economic_buyer_name,
    painHypothesis: company.pain_hypothesis,
    capturedSignals,
    pendingNextSteps: (stepsRes.data ?? []) as { title: string; due_date: string | null }[],
    recentActivities: (activitiesRes.data ?? []) as { date: string; type: string; title: string }[],
    todayISO: format(new Date(), "yyyy-MM-dd"),
  }

  let raw: unknown
  try {
    raw = await getCopilotProvider().interpret(ctx, questionTitle, narration)
  } catch (err) {
    console.error("Copilot interpret error:", err)
    return jsonResponse({ error: "Não consegui interpretar. Tente de novo." }, 502)
  }

  const validated = copilotUpdateProposalSchema.safeParse(raw)
  if (!validated.success) {
    return jsonResponse(
      { error: "Não consegui interpretar. Reformule ou use os botões." },
      502
    )
  }

  const proposal = validated.data

  // Clamps de sanidade: o modelo não decide sozinho o que é seguro aplicar.
  if (proposal.stage_target_title && !allStageTitles.includes(proposal.stage_target_title)) {
    proposal.stage_target_title = null
  }
  // Narração vaga nunca move card: um stage event errado fica no histórico pra sempre.
  if (proposal.confidence === "low") {
    proposal.stage_move = "none"
    proposal.stage_target_title = null
  }
  proposal.commitment_signals = proposal.commitment_signals.filter(
    (s) => !capturedSignals.includes(s)
  )

  return jsonResponse({ proposal })
}
