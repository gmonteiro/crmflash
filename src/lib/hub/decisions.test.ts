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
