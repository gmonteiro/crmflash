import { describe, it, expect } from "vitest"
import { z } from "zod"
import { listShortlists } from "./list-shortlists"
import { shortlistMembers } from "./shortlist-members"

const SL = "11111111-1111-4111-8111-111111111111"

describe("list_shortlists", () => {
  it("roda sem argumento nenhum", () => {
    expect(listShortlists.input.safeParse({}).success).toBe(true)
  })

  it("gera JSON Schema", () => {
    expect(z.toJSONSchema(listShortlists.input)).toHaveProperty("type", "object")
  })
})

describe("shortlist_members", () => {
  it("exige shortlist_id em uuid", () => {
    expect(shortlistMembers.input.safeParse({ shortlist_id: "x" }).success).toBe(false)
    expect(shortlistMembers.input.safeParse({ shortlist_id: SL }).success).toBe(true)
  })
})
