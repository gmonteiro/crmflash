import { describe, it, expect } from "vitest"
import { logActivity } from "./log-activity"
import { setNextStep } from "./set-next-step"
import { fakeSupabase } from "@/lib/mcp/fake-supabase"
import type { McpIdentity } from "@/lib/mcp/identity"

const CO = "11111111-1111-4111-8111-111111111111"

function identity(client: unknown): McpIdentity {
  return {
    userId: "user-1",
    workspaceId: "ws-1",
    supabase: client as McpIdentity["supabase"],
  }
}

describe("log_activity", () => {
  it("exige client_engaged — não tem default", () => {
    const parsed = logActivity.input.safeParse({
      company_id: CO,
      type: "meeting",
      title: "Reunião de diagnóstico",
    })
    expect(parsed.success).toBe(false)
  })

  it("com client_engaged true, sobe last_client_event_at", async () => {
    const { client, calls } = fakeSupabase({ company_activities: [] })
    await logActivity.handler(identity(client), {
      company_id: CO,
      type: "meeting",
      title: "Reunião de diagnóstico",
      description: null,
      client_engaged: true,
      answers_question_key: null,
    })

    const update = calls.find((c) => c.table === "companies" && c.op === "update")
    expect(update?.payload).toHaveProperty("last_client_event_at")
  })

  it("com client_engaged false, NÃO sobe last_client_event_at", async () => {
    const { client, calls } = fakeSupabase({ company_activities: [] })
    await logActivity.handler(identity(client), {
      company_id: CO,
      type: "note",
      title: "Cobrei, aguardando resposta",
      description: null,
      client_engaged: false,
      answers_question_key: null,
    })

    expect(calls.some((c) => c.table === "companies" && c.op === "update")).toBe(false)
    expect(calls.some((c) => c.table === "company_activities" && c.op === "insert")).toBe(true)
  })

  it("recusa duplicata exata nas últimas 24h e devolve a existente", async () => {
    const existing = { id: "act-1", type: "meeting", title: "Reunião de diagnóstico" }
    const { client, calls } = fakeSupabase({ company_activities: [existing] })

    const out = await logActivity.handler(identity(client), {
      company_id: CO,
      type: "meeting",
      title: "Reunião de diagnóstico",
      description: null,
      client_engaged: true,
      answers_question_key: null,
    })

    expect(out).toMatchObject({ deduplicated: true, activity_id: "act-1" })
    expect(calls.some((c) => c.table === "company_activities" && c.op === "insert")).toBe(false)
  })
})

describe("set_next_step", () => {
  it("exige uma das duas formas de prazo", () => {
    expect(
      setNextStep.input.safeParse({ company_id: CO, title: "Mandar proposta" }).success
    ).toBe(false)
    expect(
      setNextStep.input.safeParse({
        company_id: CO,
        title: "Mandar proposta",
        due_date: "2026-09-10",
      }).success
    ).toBe(true)
    expect(
      setNextStep.input.safeParse({ company_id: CO, title: "Mandar proposta", in_days: 3 })
        .success
    ).toBe(true)
  })
})
