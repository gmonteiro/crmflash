import { describe, it, expect } from "vitest"
import { z } from "zod"
import { answerWithAction, isDestructive } from "./answer-with-action"
import type { CopilotQuickAction } from "@/types/copilot"

const CO = "11111111-1111-4111-8111-111111111111"

function action(over: Partial<CopilotQuickAction> = {}): CopilotQuickAction {
  return {
    id: "advanced",
    label: "Avançou de estágio",
    suppressDays: 7,
    effects: [{ kind: "move_stage", target: "next" }],
    ...over,
  }
}

describe("isDestructive", () => {
  it("marca a ação que apaga próximo passo", () => {
    expect(
      isDestructive(action({ effects: [{ kind: "delete_next_step", stepId: "s-1" }] }))
    ).toBe(true)
  })

  it("não marca as demais", () => {
    expect(isDestructive(action())).toBe(false)
    expect(
      isDestructive(action({ effects: [{ kind: "complete_next_step", stepId: "s-1" }] }))
    ).toBe(false)
  })

  it("marca mesmo quando o efeito destrutivo não é o primeiro", () => {
    expect(
      isDestructive(
        action({
          effects: [{ kind: "note", text: "x" }, { kind: "delete_next_step", stepId: "s-1" }],
        })
      )
    ).toBe(true)
  })
})

describe("schema", () => {
  it("exige question_key e action_id", () => {
    expect(answerWithAction.input.safeParse({ question_key: `no_next_step:${CO}` }).success).toBe(
      false
    )
    expect(
      answerWithAction.input.safeParse({
        question_key: `no_next_step:${CO}`,
        action_id: "tomorrow",
      }).success
    ).toBe(true)
  })

  it("gera JSON Schema", () => {
    expect(z.toJSONSchema(answerWithAction.input)).toHaveProperty("type", "object")
  })
})
