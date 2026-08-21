import { describe, it, expect } from "vitest"
import { toIlikePattern } from "./search-term"

describe("toIlikePattern", () => {
  it("envolve o termo em curingas", () => {
    expect(toIlikePattern("acme")).toBe("%acme%")
  })

  it("neutraliza curingas digitados pelo usuário", () => {
    expect(toIlikePattern("%")).toBe("")
    expect(toIlikePattern("ac%me")).toBe("%ac me%")
  })

  it("remove os separadores da sintaxe de filtro do PostgREST", () => {
    expect(toIlikePattern('Acme, Inc (Brasil)')).toBe("%Acme Inc Brasil%")
  })

  it("colapsa espaços e apara as bordas", () => {
    expect(toIlikePattern("  beta   corp  ")).toBe("%beta corp%")
  })

  it("termo vazio não vira busca", () => {
    expect(toIlikePattern("   ")).toBe("")
  })
})
