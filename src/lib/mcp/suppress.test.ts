import { describe, it, expect } from "vitest"
import { parseQuestionKey, suppressFromWrite } from "./suppress"
import { fakeSupabase } from "./fake-supabase"

const CO = "11111111-1111-4111-8111-111111111111"

describe("parseQuestionKey", () => {
  it("separa regra e empresa de uma chave de dois campos", () => {
    expect(parseQuestionKey(`no_next_step:${CO}`)).toEqual({
      ruleId: "no_next_step",
      companyId: CO,
    })
  })

  it("ignora o terceiro campo, que é a entidade", () => {
    expect(parseQuestionKey(`next_step_overdue:${CO}:algum-step-id`)).toEqual({
      ruleId: "next_step_overdue",
      companyId: CO,
    })
  })

  it("recusa regra que não existe", () => {
    expect(parseQuestionKey(`regra_inventada:${CO}`)).toBeNull()
  })

  it("recusa chave malformada", () => {
    expect(parseQuestionKey("sem_dois_pontos")).toBeNull()
    expect(parseQuestionKey("")).toBeNull()
  })
})

describe("suppressFromWrite", () => {
  const base = { workspaceId: "ws-1", userId: "user-1", companyId: CO }

  it("grava o evento com os dias da regra", async () => {
    const { client, calls } = fakeSupabase()

    const out = await suppressFromWrite(client, {
      ...base,
      questionKey: `missing_pain_hypothesis:${CO}`,
      applied: { tool: "set_company_context", updated: ["pain_hypothesis"] },
    })

    expect(out.suppressed).toBe(true)
    const insert = calls.find((c) => c.table === "copilot_question_events")
    expect(insert!.payload).toMatchObject({
      question_key: `missing_pain_hypothesis:${CO}`,
      rule_id: "missing_pain_hypothesis",
      status: "answered",
    })
  })

  it("preenche o applied, que é o registro do que foi feito", async () => {
    const { client, calls } = fakeSupabase()

    await suppressFromWrite(client, {
      ...base,
      questionKey: `no_next_step:${CO}`,
      applied: { tool: "set_next_step", title: "Mandar proposta" },
    })

    const insert = calls.find((c) => c.table === "copilot_question_events")
    expect(insert!.payload).toHaveProperty("applied")
    expect((insert!.payload as { applied: unknown }).applied).toMatchObject({
      tool: "set_next_step",
    })
  })

  it("recusa chave de outra empresa sem gravar nada", async () => {
    const { client, calls } = fakeSupabase()

    const out = await suppressFromWrite(client, {
      ...base,
      questionKey: "no_next_step:22222222-2222-4222-8222-222222222222",
      applied: {},
    })

    expect(out.suppressed).toBe(false)
    expect(out.reason).toMatch(/outra empresa/)
    expect(calls).toHaveLength(0)
  })

  it("recusa chave inválida sem gravar nada", async () => {
    const { client, calls } = fakeSupabase()

    const out = await suppressFromWrite(client, {
      ...base,
      questionKey: "lixo",
      applied: {},
    })

    expect(out.suppressed).toBe(false)
    expect(calls).toHaveLength(0)
  })
})
