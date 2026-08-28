import { z } from "zod"
import { recordCopilotEvent } from "@/lib/pipeline/copilot-events"
import type { McpTool } from "../registry"

const input = z.object({
  company_id: z.string().uuid(),
  question_key: z
    .string()
    .min(1)
    .describe("Copie exatamente o question_key devolvido por whats_stuck."),
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
    .enum(["snoozed", "dismissed"])
    .describe("snoozed = adiar; dismissed = essa pergunta não se aplica a esta conta."),
  suppress_days: z
    .number()
    .int()
    .min(1)
    .max(365)
    .describe("Dias até a pergunta voltar. Use 365 para dismissed."),
  reason: z
    .string()
    .nullable()
    .default(null)
    .describe("Por que está sendo adiada ou descartada."),
})

export const snoozeCopilotQuestion: McpTool<typeof input> = {
  name: "snooze_copilot_question",
  description:
    "Adia uma pendência de whats_stuck, ou marca que ela não se aplica. Use SOMENTE " +
    "quando não há nada a registrar — cliente de férias, pergunta sem sentido para " +
    "essa conta. Para dizer que a pendência foi TRATADA, use answer_with_action ou " +
    "passe o question_key na tool de escrita: uma pendência não pode sair da fila " +
    "como resolvida sem que algo tenha sido escrito.",
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
      answerText: args.reason,
    })

    return {
      question_key: args.question_key,
      status: args.status,
      hidden_for_days: args.suppress_days,
    }
  },
}
