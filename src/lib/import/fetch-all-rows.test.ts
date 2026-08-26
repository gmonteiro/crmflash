import { describe, it, expect, vi } from "vitest"
import { fetchAllRows, PAGE_SIZE } from "./fetch-all-rows"

/** Tabela falsa que respeita o teto de linhas do PostgREST, como o servidor. */
function fakeTable(total: number, cap = PAGE_SIZE) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: `p${i}` }))
  const ranges: Array<[number, number]> = []

  const build = () => ({
    range: async (from: number, to: number) => {
      ranges.push([from, to])
      const wanted = Math.min(to - from + 1, cap)
      return { data: rows.slice(from, from + wanted), error: null }
    },
  })

  return { build, ranges, rows }
}

describe("fetchAllRows", () => {
  it("le a tabela inteira quando ela passa do teto de uma resposta", async () => {
    // O caso real: 4.278 pessoas, das quais o import so enxergava 1.000.
    const { build, ranges } = fakeTable(4278)

    const all = await fetchAllRows(build)

    expect(all).toHaveLength(4278)
    expect(all[4277]).toEqual({ id: "p4277" })
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [3000, 3999],
      [4000, 4999],
    ])
  })

  it("nao pede outra pagina quando a tabela acaba antes do teto", async () => {
    const { build, ranges } = fakeTable(42)

    expect(await fetchAllRows(build)).toHaveLength(42)
    expect(ranges).toHaveLength(1)
  })

  it("pede uma pagina a mais quando o total e multiplo exato de PAGE_SIZE", async () => {
    // Pagina cheia nao prova que acabou: so a vazia prova.
    const { build, ranges } = fakeTable(PAGE_SIZE)

    expect(await fetchAllRows(build)).toHaveLength(PAGE_SIZE)
    expect(ranges).toHaveLength(2)
  })

  it("monta o select de novo a cada pagina", async () => {
    // Builder do supabase-js e de uso unico: reusar acumula os .range().
    const { build } = fakeTable(2500)
    const spy = vi.fn(build)

    await fetchAllRows(spy)

    expect(spy).toHaveBeenCalledTimes(3)
  })

  it("para no erro em vez de devolver meia tabela", async () => {
    let call = 0
    const build = () => ({
      range: async (from: number) => {
        call++
        if (call > 1) return { data: null, error: { message: "boom" } }
        return {
          data: Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: `p${from + i}` })),
          error: null,
        }
      },
    })

    // Meia tabela e o bug: dedup incompleto insere duplicata e o indice
    // unico derruba o lote. Melhor voltar curto e visivel.
    expect(await fetchAllRows(build)).toHaveLength(PAGE_SIZE)
  })
})
