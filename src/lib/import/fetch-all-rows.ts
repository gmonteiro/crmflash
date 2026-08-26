// O PostgREST corta toda resposta no db-max-rows do servidor — 1000 por padrao
// no Supabase. `.limit(50000)` e pedido do cliente, nao licenca: com 4.278
// pessoas e 3.058 empresas num workspace, o select voltava o primeiro milheiro
// e o import tratava o resto como inexistente. Dedup furado, e o indice unico
// cobrando a conta la na frente — em lote, derrubando os vizinhos junto.
export const PAGE_SIZE = 1000

interface Rangeable<T> {
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
}

/**
 * Le uma tabela inteira em paginas de PAGE_SIZE.
 *
 * `build` monta o select do zero a cada pagina porque o query builder do
 * supabase-js e de uso unico: reaproveitar a instancia acumula os `.range()`.
 * Quem chama precisa ordenar por uma coluna estavel — sem ordem, o Postgres
 * nao promete a mesma sequencia entre paginas e o resultado repete e pula
 * linhas.
 */
export async function fetchAllRows<T>(build: () => Rangeable<T>): Promise<T[]> {
  const all: T[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1)

    // Para na primeira falha em vez de seguir com meia tabela: um dedup
    // silenciosamente incompleto e exatamente o bug que isto veio corrigir.
    if (error || !data) break

    all.push(...data)
    if (data.length < PAGE_SIZE) break
  }

  return all
}
