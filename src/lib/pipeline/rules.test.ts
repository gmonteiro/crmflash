import { describe, it, expect } from "vitest"
import { detectQuestions } from "./rules"
import { buildCompanyQueue } from "./queue"
import type { PipelineSnapshot } from "./types"

const STAGES = [
  "Alvos",
  "Contato",
  "Diagnóstico",
  "Dor validada",
  "Solução desenhada",
  "Prova",
  "Aprovação",
  "Ganho",
  "Perdido",
  "Gelado",
]

const NOW = new Date("2026-08-20T12:00:00Z")

// Empresa "bagunçada" de propósito: parada há muito tempo, sem champion, sem dor
// e sem próximo passo. Dispara várias regras de uma vez, que é exatamente o caso
// que os tetos precisam cortar.
function messyCompany(id: string) {
  return {
    id,
    name: `Empresa ${id}`,
    kanban_column_id: "col-5",
    kanban_position: 1,
    last_client_event_at: "2026-07-01T12:00:00Z",
    champion_name: null,
    economic_buyer_name: null,
    pain_hypothesis: null,
  }
}

function snapshot(companyIds: string[]): PipelineSnapshot {
  return {
    now: NOW,
    columns: STAGES.map((title, i) => ({
      id: `col-${i + 1}`,
      title,
      color: "#000",
      position: i + 1,
    })),
    companies: companyIds.map(messyCompany),
    events: companyIds.map((id) => ({
      company_id: id,
      from_title: "Dor validada",
      to_title: "Solução desenhada",
      to_column_id: "col-5",
      to_position: 5,
      direction: "advance" as const,
      occurred_at: "2026-07-01T12:00:00Z",
    })),
    signals: [],
    nextSteps: [],
    activities: [],
    people: [],
  }
}

describe("detectQuestions — tetos", () => {
  it("uma empresa bagunçada gera várias pendências", () => {
    const found = detectQuestions(snapshot(["a"]), new Set(), { limit: 6, maxPerCompany: 99 })
    expect(found.length).toBeGreaterThan(1)
    expect(new Set(found.map((q) => q.companyId))).toEqual(new Set(["a"]))
  })

  it("maxPerCompany corta as pendências de um card, não a empresa", () => {
    const found = detectQuestions(snapshot(["a"]), new Set(), { limit: 6, maxPerCompany: 4 })
    expect(found).toHaveLength(4)
    expect(buildCompanyQueue(found)).toHaveLength(1)
  })

  it("limit conta EMPRESAS, não pendências", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"]
    const queue = buildCompanyQueue(
      detectQuestions(snapshot(ids), new Set(), { limit: 6, maxPerCompany: 4 })
    )
    expect(queue).toHaveLength(6)
    // cada conta que entrou veio inteira, até o teto do card
    for (const item of queue) expect(item.pendings).toHaveLength(4)
  })

  it("as pendências vêm ordenadas por prioridade dentro do card", () => {
    const [item] = buildCompanyQueue(
      detectQuestions(snapshot(["a"]), new Set(), { limit: 6, maxPerCompany: 4 })
    )
    const priorities = item.pendings.map((p) => p.priority)
    expect([...priorities].sort((x, y) => y - x)).toEqual(priorities)
  })

  it("chave suprimida não volta para a fila", () => {
    const all = detectQuestions(snapshot(["a"]), new Set(), { limit: 6, maxPerCompany: 99 })
    const suppressed = new Set([all[0].key])
    const found = detectQuestions(snapshot(["a"]), suppressed, { limit: 6, maxPerCompany: 99 })
    expect(found.map((q) => q.key)).not.toContain(all[0].key)
  })
})
