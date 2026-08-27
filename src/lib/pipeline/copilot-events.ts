import type { SupabaseClient } from "@supabase/supabase-js"
import { addDays, format } from "date-fns"
import type { CopilotRuleId } from "@/types/copilot"

const DATE_FMT = "yyyy-MM-dd"

export interface RecordCopilotEventParams {
  workspaceId: string
  userId: string | null
  companyId: string
  questionKey: string
  ruleId: CopilotRuleId
  status: "answered" | "snoozed" | "dismissed"
  suppressDays: number
  actionId?: string | null
  answerText?: string | null
  applied?: Record<string, unknown> | null
}

// É este insert que faz a pergunta sumir da fila até suppress_until. Único
// mecanismo de dedup/snooze/dismiss — ver spec, módulo 11.3.
export async function recordCopilotEvent(
  supabase: SupabaseClient,
  params: RecordCopilotEventParams
): Promise<void> {
  await supabase.from("copilot_question_events").insert({
    workspace_id: params.workspaceId,
    user_id: params.userId,
    company_id: params.companyId,
    question_key: params.questionKey,
    rule_id: params.ruleId,
    status: params.status,
    action_id: params.actionId ?? null,
    answer_text: params.answerText ?? null,
    applied: params.applied ?? null,
    suppress_until: format(addDays(new Date(), params.suppressDays), DATE_FMT),
  })
}
