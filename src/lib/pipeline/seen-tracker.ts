// Decide quando o usuário "viu" o card de uma conta e passou adiante.
//
// Por que é uma função pura e não um efeito no painel: a regra tem três
// condições (ficou tempo suficiente, foi para OUTRA conta, ainda não foi
// tratada nesta sessão) e com o relógio injetado dá para testar sem React nem
// timers falsos.
//
// Quem consome: copilot-panel chama focus() toda vez que a conta em foco muda
// e skip() antes de responder/adiar, para a conta que sai por resposta não
// ser gravada como "vista".

export interface SeenTracker {
  /** Conta que entrou em foco (null = fila vazia). Devolve a que saiu e merece
   *  'seen', ou null. */
  focus(companyId: string | null, now: number): string | null
  /** Conta já tratada (respondida, adiada): focus nunca mais a devolve. */
  skip(companyId: string): void
}

export function createSeenTracker(minDwellMs = 3000): SeenTracker {
  let current: { companyId: string; since: number } | null = null
  const handled = new Set<string>()

  return {
    focus(companyId, now) {
      if (current && current.companyId === companyId) return null

      // Fila esvaziou (respondeu tudo, refetch): ninguém "passou adiante".
      if (!companyId) {
        current = null
        return null
      }

      let left: string | null = null
      if (
        current &&
        !handled.has(current.companyId) &&
        now - current.since >= minDwellMs
      ) {
        left = current.companyId
        handled.add(left)
      }

      current = { companyId, since: now }
      return left
    },
    skip(companyId) {
      handled.add(companyId)
    },
  }
}
