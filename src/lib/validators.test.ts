import { describe, it, expect } from "vitest"
import { integrationActivitySchema, integrationNextStepsSchema } from "./validators"

const COMPANY = "11111111-2222-3333-4444-555555555555"
const base = { company_id: COMPANY, title: "Reunião", source_meeting_id: "m-1" }

describe("integrationActivitySchema", () => {
  it("payload antigo continua valendo, sem os campos novos", () => {
    const r = integrationActivitySchema.safeParse({ ...base, summary: { action_items: ["a"] } })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.next_steps).toBeUndefined()
  })

  it("aceita o formato que o TranscriptionApp manda", () => {
    const r = integrationActivitySchema.safeParse({
      ...base,
      next_steps: [{ title: " Enviar proposta ", due_date: "2026-10-14", assignee: "Gabriel", source_action_item_id: "ai-1" }],
      signals: [{ type: "asked_price", evidence: "pediu preço" }, { type: "second_interlocutor" }],
      contacts: [{ name: "João Silva" }, { name: "Ana", role: "CFO", email: "ana@acme.com.br" }],
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.next_steps![0].title).toBe("Enviar proposta")
  })

  it("recusa prazo fora de AAAA-MM-DD ou data impossível", () => {
    for (const due_date of ["14/10/2026", "2026-02-30"]) {
      const r = integrationActivitySchema.safeParse({ ...base, next_steps: [{ title: "x", due_date }] })
      expect(r.success).toBe(false)
    }
  })

  it("recusa sinal fora da lista, contato sem nome e e-mail inválido", () => {
    expect(integrationActivitySchema.safeParse({ ...base, signals: [{ type: "gostou" }] }).success).toBe(false)
    expect(integrationActivitySchema.safeParse({ ...base, contacts: [{ name: " " }] }).success).toBe(false)
    expect(integrationActivitySchema.safeParse({ ...base, contacts: [{ name: "A", email: "nao-e-email" }] }).success).toBe(false)
  })

  it("e-mail vazio de contato vira ausente, não erro", () => {
    const r = integrationActivitySchema.safeParse({ ...base, contacts: [{ name: "A", email: "" }] })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.contacts![0].email).toBeNull()
  })
})

describe("integrationNextStepsSchema", () => {
  it("exige empresa, reunião e ao menos um passo", () => {
    expect(integrationNextStepsSchema.safeParse({ company_id: COMPANY, source_meeting_id: "m-1", next_steps: [{ title: "x" }] }).success).toBe(true)
    expect(integrationNextStepsSchema.safeParse({ company_id: COMPANY, source_meeting_id: "m-1", next_steps: [] }).success).toBe(false)
    expect(integrationNextStepsSchema.safeParse({ source_meeting_id: "m-1", next_steps: [{ title: "x" }] }).success).toBe(false)
  })
})
