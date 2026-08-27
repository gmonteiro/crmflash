import { z } from "zod"
import { recordCopilotEvent } from "@/lib/pipeline/copilot-events"
import type { McpTool } from "../registry"

const input = z.object({
  company_id: z.string().uuid(),
  question_key: z
    .string()
    .min(1)
    .describe("Copie exatamente o question_key devolvido por whats_stuck. Não invente."),
  rule_id: z.enum([
    "meeting_yesterday",
    "next_step_overdue",
    "no_next_step",
    "frozen_candidate",
    "stalled_card",
    "no_signal_past_stage",
    "exit_criteria_unmet",
    "missing_champion",
    "missing_pain_hypothesis",
  ]),
  status: z
    .enum(["answered", "snoozed", "dismissed"])
    .describe("answered = tratada; snoozed = adiada; dismissed = não se aplica."),
  suppress_days: z
    .number()
    .int()
    .min(1)
    .max(365)
    .describe("Dias até a pergunta voltar. Use 365 para dismissed."),
  answer_text: z.string().nullable().default(null).describe("O que a pessoa respondeu."),
})

export const answerCopilotQuestion: McpTool<typeof input> = {
  name: "answer_copilot_question",
  description:
    "Marca uma pendência de whats_stuck como tratada, para ela sumir da fila até a data " +
    "calculada. Esta tool NÃO aplica o efeito — chame antes a tool específica " +
    "(log_activity, set_next_step, move_stage, capture_signal) e só então marque a " +
    "pendência. Nunca marque uma pergunta sem ter feito o que ela pedia.",
  input,
  async handler({ supabase, workspaceId, userId }, args) {
    await recordCopilotEvent(supabase, {
      workspaceId,
      userId,
      companyId: args.company_id,
      questionKey: args.question_key,
      ruleId: args.rule_id,
      status: args.status,
      suppressDays: args.suppress_days,
      answerText: args.answer_text,
    })

    return { suppressed: args.question_key, for_days: args.suppress_days }
  },
}
