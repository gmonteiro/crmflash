import { describe, it, expect } from "vitest"
import { buildCompanyQueue } from "./queue"
import type { CopilotQuestion } from "@/types/copilot"

function q(companyId: string, ruleId: string, priority: number): CopilotQuestion {
  return {
    key: `${ruleId}:${companyId}`,
    ruleId: ruleId as CopilotQuestion["ruleId"],
    priority,
    severity: 0,
    companyId,
    companyName: `Empresa ${companyId}`,
    stageTitle: "Solução desenhada",
    title: `${ruleId} em ${companyId}`,
    actions: [],
    allowFreeText: true,
  }
}

describe("buildCompanyQueue", () => {
  it("junta as pendências da mesma empresa num item só", () => {
    const queue = buildCompanyQueue([
      q("acme", "stalled_card", 80),
      q("beta", "no_next_step", 90),
      q("acme", "missing_champion", 50),
    ])

    expect(queue).toHaveLength(2)
    expect(queue.map((c) => c.companyId)).toEqual(["acme", "beta"])
    expect(queue[0].pendings.map((p) => p.ruleId)).toEqual(["stalled_card", "missing_champion"])
  })

  it("a conta herda a prioridade da pendência mais urgente", () => {
    const queue = buildCompanyQueue([q("acme", "stalled_card", 80), q("acme", "missing_champion", 50)])
    expect(queue[0].priority).toBe(80)
  })

  it("preserva a ordem de entrada das contas (já ordenada por prioridade)", () => {
    const queue = buildCompanyQueue([
      q("a", "meeting_yesterday", 100),
      q("b", "no_next_step", 90),
      q("c", "missing_champion", 50),
      q("a", "stalled_card", 80),
    ])
    expect(queue.map((c) => c.companyId)).toEqual(["a", "b", "c"])
  })

  it("fila vazia devolve lista vazia", () => {
    expect(buildCompanyQueue([])).toEqual([])
  })
})
