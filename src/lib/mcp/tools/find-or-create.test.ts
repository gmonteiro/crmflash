import { describe, it, expect } from "vitest"
import { findOrCreateCompany } from "./find-or-create-company"
import { findOrCreatePerson } from "./find-or-create-person"
import { fakeSupabase } from "@/lib/mcp/fake-supabase"
import type { McpIdentity } from "@/lib/mcp/identity"

function identity(client: unknown): McpIdentity {
  return { userId: "user-1", workspaceId: "ws-1", supabase: client as McpIdentity["supabase"] }
}

describe("find_or_create_company", () => {
  it("devolve a existente sem inserir, ignorando caixa", async () => {
    const { client, calls } = fakeSupabase({ companies: [{ id: "co-1", name: "Acme" }] })

    const out = await findOrCreateCompany.handler(identity(client), { name: "ACME" })

    expect(out).toMatchObject({ created: false, company_id: "co-1" })
    expect(calls.some((c) => c.op === "insert")).toBe(false)
  })

  it("recusa nome vazio", () => {
    expect(findOrCreateCompany.input.safeParse({ name: "   " }).success).toBe(false)
  })
})

describe("find_or_create_person", () => {
  it("exige nome e sobrenome", () => {
    expect(findOrCreatePerson.input.safeParse({ first_name: "Ana" }).success).toBe(false)
    expect(
      findOrCreatePerson.input.safeParse({ first_name: "Ana", last_name: "Silva" }).success
    ).toBe(true)
  })
})

describe("find_or_create_person — busca pela chave do banco", () => {
  it("consulta por dedup_key, nao por nome", async () => {
    const { client, calls } = fakeSupabase({
      people: [{ id: "pe-1", full_name: "Ana Silva" }],
    })

    const out = await findOrCreatePerson.handler(identity(client), {
      first_name: "Ana",
      last_name: "Silva",
      current_title: "CTO",
      current_company: "Acme",
      company_id: null,
      email: null,
    })

    expect(out).toMatchObject({ created: false, person_id: "pe-1" })
    const query = calls.find((c) => c.table === "people")
    // A chave exata, igual a coluna gerada da migration 015.
    expect(query!.filters).toEqual({ dedup_key: "ana|silva|cto|acme" })
    expect(calls.some((c) => c.op === "insert")).toBe(false)
  })
})
