import { describe, it, expect } from "vitest"
import { memberColumn, checkEntityMatches } from "./shortlists"

describe("memberColumn", () => {
  it("mapeia o tipo da lista para a coluna do vínculo", () => {
    expect(memberColumn("person")).toBe("person_id")
    expect(memberColumn("company")).toBe("company_id")
  })
})

describe("checkEntityMatches", () => {
  it("aceita pessoa em lista de pessoa", () => {
    expect(checkEntityMatches("person", { person: true, company: false }).ok).toBe(true)
  })

  it("aceita empresa em lista de empresa", () => {
    expect(checkEntityMatches("company", { person: false, company: true }).ok).toBe(true)
  })

  it("recusa empresa em lista de pessoa", () => {
    const out = checkEntityMatches("person", { person: false, company: true })
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/lista de pessoas/)
  })

  it("recusa pessoa em lista de empresa", () => {
    const out = checkEntityMatches("company", { person: true, company: false })
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/lista de empresas/)
  })

  it("recusa id que não existe em lugar nenhum", () => {
    const out = checkEntityMatches("person", { person: false, company: false })
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/não existe/)
  })
})
