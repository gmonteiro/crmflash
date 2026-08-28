import { describe, it, expect } from "vitest"
import { updateCompany, EDITABLE_FIELDS } from "./update-company"
import { fakeSupabase } from "@/lib/mcp/fake-supabase"
import type { McpIdentity } from "@/lib/mcp/identity"

const CO = "11111111-1111-4111-8111-111111111111"

function identity(client: unknown): McpIdentity {
  return { userId: "user-1", workspaceId: "ws-1", supabase: client as McpIdentity["supabase"] }
}

const EMPTY = {
  industry: undefined,
  website: undefined,
  domain: undefined,
  size_tier: undefined,
  employee_count: undefined,
  estimated_revenue: undefined,
  description: undefined,
  linkedin_url: undefined,
}

describe("EDITABLE_FIELDS", () => {
  it("não inclui name — renomear é decisão de app", () => {
    expect(EDITABLE_FIELDS).not.toContain("name")
  })

  it("cobre os campos que o enrich preenche", () => {
    for (const f of [
      "industry",
      "website",
      "domain",
      "size_tier",
      "employee_count",
      "estimated_revenue",
      "description",
      "linkedin_url",
    ]) {
      expect(EDITABLE_FIELDS).toContain(f)
    }
  })
})

describe("schema", () => {
  it("exige pelo menos um campo", () => {
    expect(updateCompany.input.safeParse({ company_id: CO }).success).toBe(false)
    expect(updateCompany.input.safeParse({ company_id: CO, industry: "Varejo" }).success).toBe(
      true
    )
  })

  it("não aceita name", () => {
    const parsed = updateCompany.input.safeParse({ company_id: CO, name: "Outro Nome" })
    expect(parsed.success).toBe(false)
  })

  it("employee_count precisa ser inteiro não negativo", () => {
    expect(updateCompany.input.safeParse({ company_id: CO, employee_count: -1 }).success).toBe(
      false
    )
    expect(updateCompany.input.safeParse({ company_id: CO, employee_count: 300 }).success).toBe(
      true
    )
  })
})

describe("handler", () => {
  it("devolve o valor anterior de cada campo — sobrescrita não pode ser silenciosa", async () => {
    const { client, calls } = fakeSupabase({
      companies: [{ id: CO, name: "Acme", industry: "Antigo", employee_count: 10 }],
    })

    const out = (await updateCompany.handler(identity(client), {
      ...EMPTY,
      company_id: CO,
      industry: "Varejo",
      employee_count: 300,
    })) as { changed: { field: string; from: unknown; to: unknown }[] }

    expect(out.changed).toEqual([
      { field: "industry", from: "Antigo", to: "Varejo" },
      { field: "employee_count", from: 10, to: 300 },
    ])

    const update = calls.find((c) => c.table === "companies" && c.op === "update")
    expect(update!.payload).toEqual({ industry: "Varejo", employee_count: 300 })
  })

  it("não escreve last_client_event_at — descobrir dado não é o cliente agindo", async () => {
    const { client, calls } = fakeSupabase({ companies: [{ id: CO, name: "Acme" }] })

    await updateCompany.handler(identity(client), {
      ...EMPTY,
      company_id: CO,
      industry: "Varejo",
    })

    const update = calls.find((c) => c.table === "companies" && c.op === "update")
    expect(update!.payload).not.toHaveProperty("last_client_event_at")
  })

  it("campo que era nulo volta como from: null", async () => {
    const { client } = fakeSupabase({ companies: [{ id: CO, name: "Acme" }] })

    const out = (await updateCompany.handler(identity(client), {
      ...EMPTY,
      company_id: CO,
      website: "https://acme.com",
    })) as { changed: { field: string; from: unknown }[] }

    expect(out.changed).toEqual([{ field: "website", from: null, to: "https://acme.com" }])
  })
})
