import { describe, it, expect } from "vitest"
import { offerableActions } from "./whats-stuck"
import type { CopilotQuickAction } from "@/types/copilot"

const ACTIONS: CopilotQuickAction[] = [
  {
    id: "done",
    label: "Concluído",
    suppressDays: 7,
    effects: [{ kind: "complete_next_step", stepId: "s-1" }],
  },
  {
    id: "drop",
    label: "Não faz mais sentido",
    suppressDays: 30,
    effects: [{ kind: "delete_next_step", stepId: "s-1" }],
  },
  {
    id: "draft",
    label: "Redigir retomada",
    suppressDays: 0,
    effects: [{ kind: "open_drafts", draftKind: "retomada" }],
  },
]

describe("offerableActions", () => {
  it("esconde a ação de rascunho — ela não escreve nada", () => {
    expect(offerableActions(ACTIONS).map((a) => a.id)).not.toContain("draft")
  })

  it("mantém a destrutiva, mas marcada", () => {
    const drop = offerableActions(ACTIONS).find((a) => a.id === "drop")
    expect(drop).toBeDefined()
    expect(drop!.only_in_app).toBe(true)
  })

  it("expõe suppress_days para o modelo saber o custo da escolha", () => {
    const done = offerableActions(ACTIONS).find((a) => a.id === "done")
    expect(done!.suppress_days).toBe(7)
    expect(done!.only_in_app).toBe(false)
  })

  it("preserva a ordem das ações", () => {
    expect(offerableActions(ACTIONS).map((a) => a.id)).toEqual(["done", "drop"])
  })
})
