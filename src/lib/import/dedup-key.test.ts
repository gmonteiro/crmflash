import { describe, it, expect } from "vitest"
import { personDedupKey, companyDedupKey } from "./dedup-key"

describe("personDedupKey", () => {
  it("ignora caixa e espaço nas bordas", () => {
    const a = personDedupKey({
      first_name: "Ana",
      last_name: "Silva",
      current_title: "CTO",
      current_company: "Acme",
    })
    const b = personDedupKey({
      first_name: "  ana ",
      last_name: "SILVA",
      current_title: " cto",
      current_company: "acme ",
    })
    expect(a).toBe(b)
  })

  it("trata ausente e vazio como a mesma coisa", () => {
    expect(personDedupKey({ first_name: "Ana", last_name: "Silva" })).toBe(
      personDedupKey({
        first_name: "Ana",
        last_name: "Silva",
        current_title: "",
        current_company: null,
      })
    )
  })

  it("separa por | na ordem nome, sobrenome, cargo, empresa", () => {
    expect(
      personDedupKey({
        first_name: "Ana",
        last_name: "Silva",
        current_title: "CTO",
        current_company: "Acme",
      })
    ).toBe("ana|silva|cto|acme")
  })
})

describe("companyDedupKey", () => {
  it("ignora caixa e espaço", () => {
    expect(companyDedupKey("  ACME  ")).toBe(companyDedupKey("acme"))
  })
})
