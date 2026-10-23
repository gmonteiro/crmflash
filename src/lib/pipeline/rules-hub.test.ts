import { describe, it, expect } from "vitest"
import { detectQuestions } from "./rules"
import type { PipelineSnapshot } from "./types"

const NOW = new Date("2026-10-20T12:00:00Z")
const STAGES = ["Alvos", "Contato", "Diagnóstico", "Dor validada", "Solução desenhada", "Prova", "Aprovação", "Ganho", "Perdido", "Gelado"]

function snap(over: Partial<PipelineSnapshot> = {}): PipelineSnapshot {
  return {
    now: NOW,
    columns: STAGES.map((title, i) => ({ id: `col-${i + 1}`, title, color: "#000", position: i + 1 })),
    companies: [
      {
        id: "acme",
        name: "Acme",
        kanban_column_id: "col-3",
        kanban_position: 1,
        last_client_event_at: "2026-10-19T12:00:00Z",
        champion_name: "Maria",
        economic_buyer_name: null,
        pain_hypothesis: "dor",
      },
    ],
    events: [],
    signals: [],
    nextSteps: [{ id: "s1", company_id: "acme", title: "x", due_date: "2026-10-30", status: "pending" }],
    activities: [],
    people: [],
    proposals: [],
    reviews: [],
    ...over,
  }
}

const rules = (s: PipelineSnapshot) => detectQuestions(s, new Set(), { maxPerCompany: 99 })

describe("meeting_yesterday com eventos do hub", () => {
  it("convite marcado ontem NÃO vira 'como foi a reunião?'", () => {
    const s = snap({
      activities: [{ id: "a1", company_id: "acme", type: "meeting", title: "Convite: X", date: "2026-10-19T15:00:00Z", kind: "meeting.scheduled" }],
    })
    expect(rules(s).some((q) => q.ruleId === "meeting_yesterday")).toBe(false)
  })
  it("reunião que aconteceu (meeting.held) continua perguntando", () => {
    const s = snap({
      activities: [{ id: "a1", company_id: "acme", type: "meeting", title: "Reunião: X", date: "2026-10-19T15:00:00Z", kind: "meeting.held" }],
    })
    expect(rules(s).some((q) => q.ruleId === "meeting_yesterday")).toBe(true)
  })
  it("linha antiga, sem kind, segue como antes", () => {
    const s = snap({ activities: [{ id: "a1", company_id: "acme", type: "meeting", title: "X", date: "2026-10-19T15:00:00Z" }] })
    expect(rules(s).some((q) => q.ruleId === "meeting_yesterday")).toBe(true)
  })
})

describe("inference_proposed", () => {
  const stage = {
    id: "inf-1",
    company_id: "acme",
    field: "stage_suggestion",
    value: { target_stage: "Dor validada" },
    evidence: [{ quote: "perde dois dias por mês", locator: "trecho 2 · João" }],
    created_at: "2026-10-20T10:00:00Z",
  }

  it("sugestão de estágio: aceitar move E marca a proposta; recusar só marca", () => {
    const q = rules(snap({ proposals: [stage] })).find((x) => x.ruleId === "inference_proposed")!
    expect(q.title).toMatch(/"Diagnóstico" para "Dor validada"/)
    expect(q.subtitle).toMatch(/perde dois dias/)
    const accept = q.actions.find((a) => a.id === "accept")!
    expect(accept.effects).toEqual([
      { kind: "move_stage", target: "title", title: "Dor validada" },
      { kind: "decide_inference", inferenceId: "inf-1", decision: "accept" },
    ])
    const reject = q.actions.find((a) => a.id === "reject")!
    expect(reject.effects.some((e) => e.kind === "move_stage")).toBe(false)
  })

  it("proposta de troca de champion mostra o valor anterior e o novo", () => {
    const p = { ...stage, id: "inf-2", field: "champion", value: { value: "João Silva", previous: "Maria" } }
    const q = rules(snap({ proposals: [p] })).find((x) => x.ruleId === "inference_proposed")!
    expect(q.title).toMatch(/"Maria" → "João Silva"/)
  })

  it("próximo passo que só a IA viu numa reunião revisada: pergunta se cria, com prazo", () => {
    const p = {
      ...stage,
      id: "inf-3",
      field: "next_step:abc123",
      value: { title: "Receber export do ERP", due_date: "2026-10-16", assignee: "João" },
    }
    const q = rules(snap({ proposals: [p] })).find((x) => x.ruleId === "inference_proposed")!
    expect(q.title).toMatch(/"Receber export do ERP"/)
    expect(q.title).toMatch(/16\/10/)
    expect(q.actions.find((a) => a.id === "accept")!.effects).toEqual([
      { kind: "decide_inference", inferenceId: "inf-3", decision: "accept" },
    ])
  })

  it("estágio sugerido igual ao atual não pergunta nada", () => {
    const same = { ...stage, value: { target_stage: "Diagnóstico" } }
    expect(rules(snap({ proposals: [same] })).some((x) => x.ruleId === "inference_proposed")).toBe(false)
  })
})

describe("identity_ambiguous", () => {
  it("um botão por candidato + ignorar, e a escolha vira resolve_review", () => {
    const review = {
      id: "rev-1",
      company_id: "acme",
      reason: "homonimos_na_empresa",
      observed: { email: "joao.s@acme.com.br", name: "João S." },
      candidates: [
        { personId: "p1", label: "João Silva" },
        { personId: "p2", label: "João Santos" },
      ],
      created_at: "2026-10-20T10:00:00Z",
    }
    const q = rules(snap({ reviews: [review] })).find((x) => x.ruleId === "identity_ambiguous")!
    expect(q.actions.map((a) => a.label)).toEqual(["É João Silva", "É João Santos", "Ignorar este contato"])
    expect(q.actions[0].effects[0]).toEqual({
      kind: "resolve_review",
      reviewId: "rev-1",
      resolution: { type: "link_person", personId: "p1" },
    })
  })
})
