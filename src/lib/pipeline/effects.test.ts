import { describe, it, expect } from "vitest"
import { applyEffect } from "./effects"
import { fakeSupabase } from "@/lib/mcp/fake-supabase"

const CTX = {
  workspaceId: "ws-1",
  userId: "user-1",
  companyId: "co-1",
  snapshot: null,
}

describe("applyEffect", () => {
  it("mark_client_event sobe last_client_event_at", async () => {
    const { client, calls } = fakeSupabase()
    await applyEffect(client, CTX, { kind: "mark_client_event" })

    const update = calls.find((c) => c.table === "companies" && c.op === "update")
    expect(update).toBeDefined()
    expect(update!.payload).toHaveProperty("last_client_event_at")
    expect(update!.filters).toEqual({ id: "co-1", workspace_id: "ws-1" })
  })

  it("note escreve em company_activities e NÃO sobe last_client_event_at", async () => {
    const { client, calls } = fakeSupabase()
    await applyEffect(client, CTX, { kind: "note", text: "Cobrei, aguardando" })

    const insert = calls.find((c) => c.table === "company_activities")
    expect(insert!.payload).toMatchObject({ type: "note", title: "Cobrei, aguardando" })
    expect(calls.some((c) => c.table === "companies" && c.op === "update")).toBe(false)
  })

  it("create_next_step cria o passo e a atividade espelho", async () => {
    const { client, calls } = fakeSupabase()
    await applyEffect(client, CTX, {
      kind: "create_next_step",
      title: "Mandar proposta",
      dueDate: "2026-09-01",
    })

    expect(calls.find((c) => c.table === "company_next_steps")!.payload).toMatchObject({
      title: "Mandar proposta",
      due_date: "2026-09-01",
      status: "pending",
    })
    expect(calls.find((c) => c.table === "company_activities")!.payload).toMatchObject({
      type: "next_step_created",
    })
  })

  it("complete_next_step não sobe last_client_event_at", async () => {
    const { client, calls } = fakeSupabase()
    await applyEffect(client, CTX, { kind: "complete_next_step", stepId: "step-1" })

    expect(calls.some((c) => c.table === "companies" && c.op === "update")).toBe(false)
  })

  it("capture_signal sobe last_client_event_at — o cliente fez algo", async () => {
    const { client, calls } = fakeSupabase()
    await applyEffect(client, CTX, {
      kind: "capture_signal",
      signal: "asked_price",
      label: "Perguntou preço",
    })

    const update = calls.find((c) => c.table === "companies" && c.op === "update")
    expect(update!.payload).toHaveProperty("last_client_event_at")
  })
})
