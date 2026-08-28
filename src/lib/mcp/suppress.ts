import type { SupabaseClient } from "@supabase/supabase-js"
import { NARRATION_SUPPRESS_DAYS } from "@/lib/constants"
import { recordCopilotEvent } from "@/lib/pipeline/copilot-events"
import type { CopilotRuleId } from "@/types/copilot"

const RULE_IDS: readonly CopilotRuleId[] = [
  "meeting_yesterday",
  "next_step_overdue",
  "no_next_step",
  "frozen_candidate",
  "stalled_card",
  "no_signal_past_stage",
  "exit_criteria_unmet",
  "missing_champion",
  "missing_pain_hypothesis",
]

/**
 * A chave é `rule_id:company_id[:entity_id]` — determinística, montada em
 * rules.ts. Regra e empresa saem dela, então nenhuma tool precisa de parâmetro
 * extra para suprimir.
 */
export function parseQuestionKey(
  key: string
): { ruleId: CopilotRuleId; companyId: string } | null {
  const [ruleId, companyId] = (key ?? "").split(":")
  if (!ruleId || !companyId) return null
  if (!RULE_IDS.includes(ruleId as CopilotRuleId)) return null

  return { ruleId: ruleId as CopilotRuleId, companyId }
}

export interface SuppressFromWriteParams {
  workspaceId: string
  userId: string | null
  /** A empresa em que a tool ACABOU de escrever. */
  companyId: string
  questionKey: string
  /** O que foi feito. Vai para a coluna applied, que existe para isto. */
  applied: Record<string, unknown>
}

/**
 * Suprime a pendência porque uma escrita aconteceu.
 *
 * É chamada DEPOIS da escrita, de dentro da própria tool — é isso que torna a
 * supressão efeito colateral do trabalho, em vez de uma segunda chamada que o
 * modelo pode esquecer ou fazer sozinha.
 *
 * Chave inválida não desfaz a escrita: devolve o motivo e a pergunta continua
 * na fila. Errar para o lado de perguntar de novo é barato; errar para o lado
 * de esconder a conta não é.
 */
export async function suppressFromWrite(
  supabase: SupabaseClient,
  params: SuppressFromWriteParams
): Promise<{ suppressed: boolean; reason?: string }> {
  const parsed = parseQuestionKey(params.questionKey)
  if (!parsed) {
    return { suppressed: false, reason: "question_key inválida — a escrita foi feita" }
  }

  if (parsed.companyId !== params.companyId) {
    return {
      suppressed: false,
      reason: "a question_key é de outra empresa — a escrita foi feita",
    }
  }

  await recordCopilotEvent(supabase, {
    workspaceId: params.workspaceId,
    userId: params.userId,
    companyId: params.companyId,
    questionKey: params.questionKey,
    ruleId: parsed.ruleId,
    status: "answered",
    suppressDays: NARRATION_SUPPRESS_DAYS[parsed.ruleId] ?? 3,
    applied: params.applied,
  })

  return { suppressed: true }
}
