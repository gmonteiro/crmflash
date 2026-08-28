import { describe, it, expect } from "vitest"
import { snoozeCopilotQuestion } from "./snooze-copilot-question"
import { fakeSupabase } from "@/lib/mcp/fake-supabase"
import type { McpIdentity } from "@/lib/mcp/identity"

const CO = "11111111-1111-4111-8111-111111111111"

function identity(client: unknown): McpIdentity {
  return { userId: "user-1", workspaceId: "ws-1", supabase: client as McpIdentity["supabase"] }
}

describe("snooze_copilot_question", () => {
  it("adia sem escrever mais nada", async () => {
    const { client, calls } = fakeSupabase()

    await snoozeCopilotQuestion.handler(identity(client), {
      company_id: CO,
      question_key: `no_next_step:${CO}`,
      rule_id: "no_next_step",
      status: "snoozed",
      suppress_days: 3,
      reason: "Cliente em férias até semana que vem",
    })

    const written = calls.filter((c) => c.op === "insert")
    expect(written).toHaveLength(1)
    expect(written[0].table).toBe("copilot_question_events")
    expect(written[0].payload).toMatchObject({ status: "snoozed" })
  })

  it("NÃO aceita answered — tratar exige escrever", () => {
    const parsed = snoozeCopilotQuestion.input.safeParse({
      company_id: CO,
      question_key: `no_next_step:${CO}`,
      rule_id: "no_next_step",
      status: "answered",
      suppress_days: 3,
    })
    expect(parsed.success).toBe(false)
  })

  it("aceita dismissed", () => {
    expect(
      snoozeCopilotQuestion.input.safeParse({
        company_id: CO,
        question_key: `no_next_step:${CO}`,
        rule_id: "no_next_step",
        status: "dismissed",
        suppress_days: 365,
      }).success
    ).toBe(true)
  })

  it("recusa rule_id fora do enum de regras", () => {
    const parsed = snoozeCopilotQuestion.input.safeParse({
      company_id: CO,
      question_key: "x:y",
      rule_id: "regra_inventada",
      status: "snoozed",
      suppress_days: 3,
    })
    expect(parsed.success).toBe(false)
  })
})
