import { describe, it, expect } from "vitest"
import { answerCopilotQuestion } from "./answer-copilot-question"
import { fakeSupabase } from "@/lib/mcp/fake-supabase"
import type { McpIdentity } from "@/lib/mcp/identity"

const CO = "11111111-1111-4111-8111-111111111111"

function identity(client: unknown): McpIdentity {
  return { userId: "user-1", workspaceId: "ws-1", supabase: client as McpIdentity["supabase"] }
}

describe("answer_copilot_question", () => {
  it("grava o evento de supressão sem tocar em mais nada", async () => {
    const { client, calls } = fakeSupabase()
    await answerCopilotQuestion.handler(identity(client), {
      company_id: CO,
      question_key: "no_next_step:co-1",
      rule_id: "no_next_step",
      status: "answered",
      suppress_days: 3,
      answer_text: "Combinei follow-up pra sexta",
    })

    const written = calls.filter((c) => c.op === "insert")
    expect(written).toHaveLength(1)
    expect(written[0].table).toBe("copilot_question_events")
    expect(written[0].payload).toMatchObject({
      question_key: "no_next_step:co-1",
      status: "answered",
    })
  })

  it("recusa rule_id fora do enum de regras", () => {
    const parsed = answerCopilotQuestion.input.safeParse({
      company_id: CO,
      question_key: "x:y",
      rule_id: "regra_inventada",
      status: "answered",
      suppress_days: 3,
    })
    expect(parsed.success).toBe(false)
  })
})
