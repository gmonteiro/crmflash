import type { CompanyQueueItem, CopilotQuestion } from "@/types/copilot"

// Agrupa as perguntas atômicas de detectQuestions numa fila por empresa.
//
// Por que aqui e não dentro das regras: uma regra que produz uma pergunta é o que
// mantém `question_key` estável (rule_id:company_id) e, com ele, todo o mecanismo
// de supressão. O agrupamento é uma visão derivada, do mesmo jeito que as métricas
// derivam do snapshot — e por ser função pura dá pra testar sem banco nem React.
//
// A ordem de entrada já vem ordenada por prioridade → severidade (rules.ts), e
// esta função preserva isso: a conta herda a prioridade da sua pendência mais
// urgente, e a ordem das contas segue a da primeira aparição de cada uma.
export function buildCompanyQueue(questions: CopilotQuestion[]): CompanyQueueItem[] {
  const byCompany = new Map<string, CompanyQueueItem>()

  for (const q of questions) {
    const existing = byCompany.get(q.companyId)
    if (existing) {
      existing.pendings.push(q)
      continue
    }
    byCompany.set(q.companyId, {
      companyId: q.companyId,
      companyName: q.companyName,
      // O estágio vem da pendência mais prioritária: todas as perguntas de uma
      // conta olham o mesmo card, então o valor é o mesmo em qualquer uma delas.
      stageTitle: q.stageTitle,
      priority: q.priority,
      pendings: [q],
    })
  }

  return [...byCompany.values()]
}
