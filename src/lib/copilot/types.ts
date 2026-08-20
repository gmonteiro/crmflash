import type { CommitmentSignalType } from "@/types/database"

// Contexto da conta enviado ao modelo. Montado SEMPRE no servidor a partir do
// banco — nunca aceito do cliente, senão o usuário poderia forjar o estágio.
export interface CopilotCompanyContext {
  name: string
  stageTitle: string | null
  stageExitCriteria: string | null
  allStageTitles: string[]
  daysSinceClientEvent: number | null
  championName: string | null
  economicBuyerName: string | null
  painHypothesis: string | null
  capturedSignals: CommitmentSignalType[]
  pendingNextSteps: { title: string; due_date: string | null }[]
  recentActivities: { date: string; type: string; title: string }[]
  /** Data de hoje em yyyy-MM-dd, para o modelo resolver "sexta", "semana que vem". */
  todayISO: string
}

export interface CopilotProvider {
  /** Converte a narração do vendedor em uma proposta de updates (objeto cru, validado depois). */
  interpret(
    ctx: CopilotCompanyContext,
    question: string,
    narration: string
  ): Promise<unknown>
}
