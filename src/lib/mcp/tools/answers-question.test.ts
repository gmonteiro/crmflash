import { describe, it, expect } from "vitest"
import { logActivity } from "./log-activity"
import { setCompanyContext } from "./set-company-context"
import { fakeSupabase } from "@/lib/mcp/fake-supabase"
import type { McpIdentity } from "@/lib/mcp/identity"

const CO = "11111111-1111-4111-8111-111111111111"

function identity(client: unknown): McpIdentity {
  return { userId: "user-1", workspaceId: "ws-1", supabase: client as McpIdentity["supabase"] }
}

describe("answers_question_key em log_activity", () => {
  it("é opcional — a tool continua servindo sem pendência nenhuma", async () => {
    const { client, calls } = fakeSupabase({ company_activities: [] })

    const out = (await logActivity.handler(identity(client), {
      company_id: CO,
      type: "note",
      title: "Nota solta",
      description: null,
      client_engaged: false,
      answers_question_key: null,
    })) as { suppressed?: boolean }

    expect(out.suppressed).toBeUndefined()
    expect(calls.some((c) => c.table === "copilot_question_events")).toBe(false)
  })

  it("com a chave, escreve E suprime na mesma chamada", async () => {
    const { client, calls } = fakeSupabase({ company_activities: [] })

    const out = (await logActivity.handler(identity(client), {
      company_id: CO,
      type: "meeting",
      title: "Reunião de diagnóstico",
      description: null,
      client_engaged: true,
      answers_question_key: `meeting_yesterday:${CO}:alguma-atividade`,
    })) as { suppressed?: boolean }

    expect(out.suppressed).toBe(true)
    expect(calls.some((c) => c.table === "company_activities" && c.op === "insert")).toBe(true)
    expect(calls.some((c) => c.table === "copilot_question_events")).toBe(true)
  })

  it("chave de outra empresa: a escrita fica, a supressão não", async () => {
    const { client, calls } = fakeSupabase({ company_activities: [] })

    const out = (await logActivity.handler(identity(client), {
      company_id: CO,
      type: "note",
      title: "Nota",
      description: null,
      client_engaged: false,
      answers_question_key: "no_next_step:22222222-2222-4222-8222-222222222222",
    })) as { suppressed?: boolean; suppress_error?: string }

    expect(out.suppressed).toBe(false)
    expect(out.suppress_error).toMatch(/outra empresa/)
    expect(calls.some((c) => c.table === "company_activities" && c.op === "insert")).toBe(true)
    expect(calls.some((c) => c.table === "copilot_question_events")).toBe(false)
  })

  it("duplicata não suprime: nada foi escrito", async () => {
    const existing = { id: "act-1", type: "note", title: "Nota" }
    const { client, calls } = fakeSupabase({ company_activities: [existing] })

    const out = (await logActivity.handler(identity(client), {
      company_id: CO,
      type: "note",
      title: "Nota",
      description: null,
      client_engaged: false,
      answers_question_key: `no_next_step:${CO}`,
    })) as { deduplicated: boolean; suppressed?: boolean }

    expect(out.deduplicated).toBe(true)
    expect(calls.some((c) => c.table === "copilot_question_events")).toBe(false)
  })
})

describe("answers_question_key em set_company_context", () => {
  it("suprime quando escreveu algum campo", async () => {
    const { client, calls } = fakeSupabase()

    const out = (await setCompanyContext.handler(identity(client), {
      company_id: CO,
      champion_name: "Ana",
      economic_buyer_name: undefined,
      pain_hypothesis: undefined,
      answers_question_key: `missing_champion:${CO}`,
    })) as { suppressed?: boolean }

    expect(out.suppressed).toBe(true)
    expect(calls.some((c) => c.table === "copilot_question_events")).toBe(true)
  })
})
