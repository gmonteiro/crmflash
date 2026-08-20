import type { CommitmentSignalType } from "./database"

export type CopilotRuleId =
  | "meeting_yesterday"
  | "next_step_overdue"
  | "no_next_step"
  | "frozen_candidate"
  | "stalled_card"
  | "no_signal_past_stage"
  | "exit_criteria_unmet"
  | "missing_champion"
  | "missing_pain_hypothesis"

export type CopilotDraftKind = "cobranca" | "retomada" | "follow_up" | "pos_reuniao"

// Efeitos que uma resposta pode ter no CRM. Cada um vira uma escrita determinística
// em applyEffect() (src/hooks/use-copilot.ts).
//
// Invariante que atravessa todos: last_client_event_at só sobe quando o CLIENTE
// fez algo. Ação do vendedor (cobrar, concluir tarefa, mandar proposta) nunca bumpa.
export type CopilotEffect =
  | { kind: "none" }
  | { kind: "mark_client_event" }
  | { kind: "move_stage"; target: "next" | "prev" | "title"; title?: string }
  // dueDate (yyyy-MM-dd) tem precedência sobre inDays; um dos dois é obrigatório.
  | { kind: "create_next_step"; title: string; inDays?: number; dueDate?: string }
  | { kind: "complete_next_step"; stepId: string }
  | { kind: "reschedule_next_step"; stepId: string; inDays: number }
  | { kind: "delete_next_step"; stepId: string }
  | { kind: "capture_signal"; signal: CommitmentSignalType; label: string }
  | {
      kind: "set_field"
      field: "champion_name" | "economic_buyer_name" | "pain_hypothesis"
      value: string
    }
  | { kind: "note"; text: string }
  | { kind: "open_drafts"; draftKind: CopilotDraftKind }

export interface CopilotQuickAction {
  id: string
  label: string
  variant?: "default" | "outline" | "secondary" | "destructive"
  /** Dias em que a pergunta some do board após esta resposta. */
  suppressDays: number
  effects: CopilotEffect[]
}

export interface CopilotQuestion {
  /** Determinística: rule_id:company_id[:entity_id]. Base do dedup/supressão. */
  key: string
  ruleId: CopilotRuleId
  priority: number
  /** Severidade dentro da mesma prioridade (dias parado, dias de atraso...). */
  severity: number
  companyId: string
  companyName: string
  stageTitle: string | null
  entityId?: string
  title: string
  subtitle?: string
  actions: CopilotQuickAction[]
  allowFreeText: boolean
}

// Proposta que o LLM devolve a partir da narração em texto livre. Nunca é
// aplicada direto — o usuário confirma item a item.
export interface CopilotUpdateProposal {
  summary: string
  client_event_today: boolean
  stage_move: "none" | "advance" | "retreat" | "frozen" | "won" | "lost"
  stage_target_title: string | null
  commitment_signals: CommitmentSignalType[]
  next_step: { title: string; due_date: string | null } | null
  fields: {
    champion_name: string | null
    economic_buyer_name: string | null
    pain_hypothesis: string | null
  }
  note: string | null
  confidence: "high" | "medium" | "low"
}

// Quais itens da proposta o usuário marcou para aplicar.
export interface ProposalSelection {
  client_event: boolean
  stage: boolean
  signals: CommitmentSignalType[]
  next_step: boolean
  champion_name: boolean
  economic_buyer_name: boolean
  pain_hypothesis: boolean
  note: boolean
}
