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

    const out = await findOrCreateCompany.handler(identity(client), { name: "ACME", domain: null })

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

describe("find_or_create_company — hub (020)", () => {
  it("razão social diferente casa pelo nome normalizado", async () => {
    const { client, calls } = fakeSupabase({ companies: [{ id: "co-1", name: "Acme" }] })
    const out = await findOrCreateCompany.handler(identity(client), { name: "ACME Ltda.", domain: null })
    expect(out).toMatchObject({ created: false, company_id: "co-1", matched_by: "name" })
    const q = calls.find((c) => c.table === "companies" && c.op === "select")
    expect(q!.filters).toEqual({ name_key: "acme" })
  })

  it("domínio genérico nunca é gravado como domínio da empresa", async () => {
    const { client, calls } = fakeSupabase({ companies: [] })
    await findOrCreateCompany.handler(identity(client), { name: "Beta", domain: "contato@gmail.com" })
    expect(calls.some((c) => c.table === "company_domains")).toBe(false)
    const insert = calls.find((c) => c.table === "companies" && c.op === "insert")
    expect(insert!.payload).toMatchObject({ name: "Beta", domain: null })
  })

  it("empresa nova com domínio de verdade grava o domínio", async () => {
    const { client, calls } = fakeSupabase({ companies: [] })
    await findOrCreateCompany.handler(identity(client), { name: "Beta", domain: "https://www.beta.com.br/" })
    const dom = calls.find((c) => c.table === "company_domains" && c.op === "insert")
    expect(dom!.payload).toMatchObject({ domain: "beta.com.br" })
  })
})

describe("find_or_create_person — e-mail como chave forte", () => {
  it("e-mail conhecido devolve a pessoa sem olhar nome nem cargo", async () => {
    const { client, calls } = fakeSupabase({
      person_identities: [{ person_id: "pe-9" }],
      people: [{ id: "pe-9", full_name: "Ana Silva" }],
    })
    const out = await findOrCreatePerson.handler(identity(client), {
      first_name: "Ana",
      last_name: "Silva",
      current_title: "Diretora",
      current_company: "Acme",
      company_id: null,
      email: "Ana.Silva@Acme.com.br",
    })
    expect(out).toMatchObject({ created: false, person_id: "pe-9", matched_by: "email" })
    const q = calls.find((c) => c.table === "person_identities")
    expect(q!.filters).toEqual({ kind: "email", value_norm: "ana.silva@acme.com.br" })
    expect(calls.some((c) => c.op === "insert")).toBe(false)
  })
})
