import { describe, it, expect } from "vitest"
import { z } from "zod"
import { whatsStuck } from "./whats-stuck"
import { companySituation } from "./company-situation"
import { agenda } from "./agenda"
import { search } from "./search"

describe("schemas das tools de leitura", () => {
  it("company_situation exige company_id em uuid", () => {
    expect(companySituation.input.safeParse({ company_id: "nao-e-uuid" }).success).toBe(false)
    expect(
      companySituation.input.safeParse({
        company_id: "11111111-1111-4111-8111-111111111111",
      }).success
    ).toBe(true)
  })

  it("agenda só aceita as três janelas conhecidas", () => {
    expect(agenda.input.safeParse({ window: "overdue" }).success).toBe(true)
    expect(agenda.input.safeParse({ window: "ontem" }).success).toBe(false)
  })

  it("search exige termo não vazio", () => {
    expect(search.input.safeParse({ query: "" }).success).toBe(false)
    expect(search.input.safeParse({ query: "acme" }).success).toBe(true)
  })

  it("whats_stuck roda sem argumento nenhum", () => {
    expect(whatsStuck.input.safeParse({}).success).toBe(true)
  })

  it("todas geram JSON Schema", () => {
    for (const tool of [whatsStuck, companySituation, agenda, search]) {
      expect(z.toJSONSchema(tool.input)).toHaveProperty("type", "object")
    }
  })
})
