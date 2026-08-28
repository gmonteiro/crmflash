import { describe, it, expect } from "vitest"
import { setShortlistMembership } from "./set-shortlist-membership"

const ID = "11111111-1111-4111-8111-111111111111"

describe("schema", () => {
  it("exige os três campos", () => {
    expect(setShortlistMembership.input.safeParse({ shortlist_id: ID }).success).toBe(false)
    expect(
      setShortlistMembership.input.safeParse({
        shortlist_id: ID,
        entity_id: ID,
        member: true,
      }).success
    ).toBe(true)
  })

  it("member é booleano — entra ou sai, sem terceira opção", () => {
    expect(
      setShortlistMembership.input.safeParse({
        shortlist_id: ID,
        entity_id: ID,
        member: "sim",
      }).success
    ).toBe(false)
  })

  it("a descrição avisa que remover não apaga a pessoa", () => {
    expect(setShortlistMembership.description.toLowerCase()).toContain("não apaga")
  })
})
