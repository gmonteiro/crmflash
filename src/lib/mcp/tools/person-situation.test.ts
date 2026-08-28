import { describe, it, expect } from "vitest"
import { z } from "zod"
import { personSituation } from "./person-situation"

const PE = "11111111-1111-4111-8111-111111111111"

describe("person_situation", () => {
  it("exige person_id em uuid", () => {
    expect(personSituation.input.safeParse({ person_id: "nao-e-uuid" }).success).toBe(false)
    expect(personSituation.input.safeParse({ person_id: PE }).success).toBe(true)
  })

  it("gera JSON Schema", () => {
    expect(z.toJSONSchema(personSituation.input)).toHaveProperty("type", "object")
  })

  it("a descrição diz que não há timeline — é o que evita o modelo insistir", () => {
    expect(personSituation.description.toLowerCase()).toContain("timeline")
  })
})
