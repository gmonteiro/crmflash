import { COLUMN_ALIASES } from "@/lib/constants"

/**
 * O campo que este cabecalho representa, ou null se nao for nenhum.
 *
 * Separado de autoMapColumns porque a deteccao da linha de cabecalho
 * (find-header-row) precisa da mesma pergunta: a linha escolhida tem que ser
 * exatamente a que o mapeador entende, senao o preview mostra uma coisa e o
 * import faz outra.
 */
export function matchColumn(header: string): string | null {
  const normalized = header.toLowerCase().trim()

  // Celula vazia casaria com o primeiro alias da lista, porque
  // `alias.includes("")` e sempre verdadeiro. Coluna sem nome virava
  // first_name, e uma linha de planilha so com virgulas parecia mais
  // cabecalho que o cabecalho.
  if (!normalized) return null

  if (COLUMN_ALIASES[normalized]) return COLUMN_ALIASES[normalized]

  for (const [alias, field] of Object.entries(COLUMN_ALIASES)) {
    if (normalized.includes(alias) || alias.includes(normalized)) return field
  }

  return null
}

export function autoMapColumns(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {}

  for (const header of headers) {
    mapping[header] = matchColumn(header) ?? "__skip__"
  }

  return mapping
}
