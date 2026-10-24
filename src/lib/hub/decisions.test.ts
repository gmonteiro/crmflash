import { describe, it, expect } from "vitest"
import { decideInference } from "./decisions"
import { fakeSupabase } from "@/lib/mcp/fake-supabase"

const CTX = { workspaceId: "ws-1", userId: "user-1" }

const proposal = {
  id: "inf-3",
  company_id: "co-1",
  field: "next_step:abc123",
  value: { title: "Receber export do ERP", due_date: "2026-10-16", assignee: "João", owner: "client" },
  status: "proposed",
  source_activity_id: "act-1",
}

describe("decideInference: próximo passo proposto", () => {
  it("aceitar cria o passo, com a chave da inferência (aceitar duas vezes não duplica)", async () => {
    const { client, calls } = fakeSupabase({ inferences: [proposal] })
    const r = await decideInference(client, CTX, "inf-3", "accept")
    expect(r.ok).toBe(true)
    const insert = calls.find((c) => c.table === "company_next_steps" && c.op === "insert")!
    expect(insert.payload).toMatchObject({
      workspace_id: "ws-1",
      user_id: "user-1",
      company_id: "co-1",
      title: "Receber export do ERP",
      due_date: "2026-10-16",
      description: "Responsável: João",
      status: "pending",
      source_ref: "inf:inf-3",
      inference_id: "inf-3",
      source_activity_id: "act-1",
    })
    expect(calls.find((c) => c.table === "inferences" && c.op === "update")!.payload).toMatchObject({ status: "applied" })
  })

  it("recusar não cria passo", async () => {
    const { client, calls } = fakeSupabase({ inferences: [proposal] })
    await decideInference(client, CTX, "inf-3", "reject")
    expect(calls.some((c) => c.table === "company_next_steps")).toBe(false)
  })
})

describe("resolveReview: contato só com nome", () => {
  it("escolher a pessoa a liga à atividade da reunião", async () => {
    const { resolveReview } = await import("./decisions")
    const review = {
      id: "rev-1",
      reason: "homonimos_na_empresa",
      status: "open",
      company_id: "co-1",
      observed: { name: "João Silva", activity_id: "act-1", meeting_id: "m-1", source: "transcription_app" },
    }
    const { client, calls } = fakeSupabase({ identity_reviews: [review] })
    const r = await resolveReview(client, CTX, "rev-1", { type: "link_person", personId: "p-1" })
    expect(r.ok).toBe(true)
    expect(calls.find((c) => c.table === "activity_participants")!.payload).toMatchObject({
      activity_id: "act-1",
      person_id: "p-1",
      role: "attendee",
    })
    expect(calls.some((c) => c.table === "person_identities")).toBe(false)
  })
})

describe("resolveReview: WhatsApp", () => {
  const contato = {
    id: "rev-wa",
    reason: "whatsapp_contato",
    status: "open",
    company_id: null,
    observed: { source: "whatsapp", phone: "+5521987654321", name: "João Silva" },
  }
  const grupo = {
    id: "rev-g",
    reason: "grupo_sem_empresa",
    status: "open",
    company_id: null,
    observed: { source: "whatsapp", group_id: "120@g.us", group_name: "Lumeis <> Acme" },
  }

  it("ligar o contato grava o telefone como identidade confirmada", async () => {
    const { resolveReview } = await import("./decisions")
    const { client, calls } = fakeSupabase({ identity_reviews: [contato] })
    const r = await resolveReview(client, CTX, "rev-wa", { type: "link_person", personId: "p-1" })
    expect(r.ok).toBe(true)
    expect(calls.find((c) => c.table === "person_identities")!.payload).toMatchObject({
      person_id: "p-1",
      ignored: false,
      kind: "phone",
      value_norm: "+5521987654321",
      confidence: "confirmed",
    })
  })

  it("ignorar o contato grava o telefone como ignorado", async () => {
    const { resolveReview } = await import("./decisions")
    const { client, calls } = fakeSupabase({ identity_reviews: [contato] })
    await resolveReview(client, CTX, "rev-wa", { type: "ignore" })
    expect(calls.find((c) => c.table === "person_identities")!.payload).toMatchObject({ person_id: null, ignored: true, kind: "phone" })
  })

  it("ligar o grupo grava whatsapp_group_companies; ignorar grava ignored", async () => {
    const { resolveReview } = await import("./decisions")
    let f = fakeSupabase({ identity_reviews: [grupo] })
    await resolveReview(f.client, CTX, "rev-g", { type: "link_company", companyId: "co-1" })
    expect(f.calls.find((c) => c.table === "whatsapp_group_companies")!.payload).toMatchObject({
      workspace_id: "ws-1",
      group_id: "120@g.us",
      group_name: "Lumeis <> Acme",
      company_id: "co-1",
      ignored: false,
    })
    f = fakeSupabase({ identity_reviews: [grupo] })
    await resolveReview(f.client, CTX, "rev-g", { type: "ignore" })
    expect(f.calls.find((c) => c.table === "whatsapp_group_companies")!.payload).toMatchObject({ company_id: null, ignored: true })
  })
})
