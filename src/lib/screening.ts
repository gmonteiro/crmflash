/**
 * Chave de ordenação da fila de triagem: a mesma que o /people usa
 * (created_at desc, id asc). Dentro de um lote de import todo mundo tem o
 * mesmo created_at, então o id é o que dá posição estável.
 */
export type CutKey = { created_at: string; id: string }

/**
 * A linha mais adiantada na ordem congelada. Marcar várias de uma vez move o
 * cursor até a mais baixa da tela, não até a última clicada.
 */
export function farthest(rows: CutKey[]): CutKey {
  if (rows.length === 0) throw new Error("farthest: lista vazia")
  return rows.reduce((best, row) => {
    if (row.created_at < best.created_at) return row
    if (row.created_at === best.created_at && row.id > best.id) return row
    return best
  })
}

/**
 * "Depois do corte" em PostgREST. Quem está no corte não entra: a pessoa
 * marcada some junto com quem estava acima dela.
 */
export function afterCutFilter(cut: CutKey): string {
  return `created_at.lt.${cut.created_at},and(created_at.eq.${cut.created_at},id.gt.${cut.id})`
}
