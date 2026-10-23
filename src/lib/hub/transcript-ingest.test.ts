import { describe, it, expect, beforeEach } from "vitest"
import { MemoryHubStore } from "./memory-store"
import { ingestGoogleEvent } from "./calendar-ingest"
import { clientSpokenChars, ingestMeeting, syncTranscripts } from "./transcript-ingest"
import { quoteIsLiteral, verifyExtraction, type Extraction, type Extractor } from "./extraction"
import type { TappBundle, TappMeetingSummary, TranscriptionSource } from "@/lib/transcription/client"
import type { GoogleEvent } from "@/lib/google/calendar"

const INTERNAL = new Set(["lumeis.ai"])
const ACME = "co-acme"

const LINES = [
  { index: 1, text: "Bom dia, obrigado por virem.", speaker_id: "sp-g" },
  { index: 2, text: "Hoje a gente perde uns dois dias por mês conciliando estoque na mão.", speaker_id: "sp-j" },
  { index: 3, text: "Eu posso te mandar o export do ERP até sexta-feira.", speaker_id: "sp-j" },
  { index: 4, text: "Quanto custaria um piloto de três meses?", speaker_id: "sp-j" },
  { index: 5, text: "Mando a proposta até quarta.", speaker_id: "sp-g" },
]

function bundle(over: Partial<TappBundle> = {}): TappBundle {
  return {
    id: "m-1",
    title: "Diagnóstico Acme",
    status: "completed",
    started_at: "2026-10-10T16:02:00+00:00",
    ended_at: "2026-10-10T17:00:00+00:00",
    updated_at: "2026-10-10T17:05:00+00:00",
    google_calendar_event_id: "evt-1",
    language: "pt",
    transcript_version: "v1",
    app_url: "https://www.transcriptionapp.com.br/meetings/m-1",
    transcript: LINES.map((l) => l.text).join("\n"),
    transcript_source: "full_transcript",
    segments: LINES.map((l) => ({ ...l, start_seconds: l.index * 10, duration_seconds: 10 })),
    speakers: [
      { id: "sp-g", index: 0, label: "Pessoa 1", name: "Gabriel", email: null, raw_name: "Gabriel" },
      { id: "sp-j", index: 1, label: "Pessoa 2", name: "João Silva", email: "joao@acme.com.br", raw_name: "João Silva (joao@acme.com.br)" },
    ],
    utterances: LINES.map((l, i) => ({ speaker_id: l.speaker_id, index: i, text: l.text.repeat(4) })),
    ...over,
  }
}

const ev = (q: string, segment: number) => [{ segment, speaker: "João Silva", quote: q }]

function goodExtraction(): Extraction {
  return {
    summary: "Acme perde dois dias por mês conciliando estoque; pediu preço de piloto.",
    champion: { name: "João Silva", rationale: "ofereceu o dado", evidence: ev("posso te mandar o export do ERP", 3) },
    economic_buyer: null,
    pain_hypothesis: { text: "Conciliação manual de estoque custa 2 dias/mês", evidence: ev("perde uns dois dias por mês conciliando estoque", 2) },
    signals: [
      { type: "asked_price", evidence: ev("Quanto custaria um piloto de três meses", 4) },
      { type: "shared_real_data", evidence: ev("vou mandar o banco inteiro amanhã", 3) }, // inventada
    ],
    next_steps: [
      { title: "Enviar proposta de piloto", owner: "lumeis", assignee: "Gabriel", due_date: "2026-10-14", due_basis: "explicit", evidence: [{ segment: 5, speaker: "Gabriel", quote: "Mando a proposta até quarta" }] },
      { title: "Receber export do ERP", owner: "client", assignee: "João", due_date: "2026-10-16", due_basis: "inferred", evidence: ev("export do ERP até sexta-feira", 3) },
    ],
    stage_suggestion: { target_stage: "Dor validada", rationale: "dor quantificada", evidence: ev("perde uns dois dias por mês", 2) },
  }
}

class FakeSource implements TranscriptionSource {
  constructor(public bundles: TappBundle[]) {}
  async listUpdated(since: string | null): Promise<TappMeetingSummary[]> {
    return this.bundles.filter((b) => !since || b.updated_at >= since)
  }
  async getBundle(id: string) {
    return this.bundles.find((b) => b.id === id) ?? null
  }
}

class CountingExtractor implements Extractor {
  calls = 0
  constructor(private result: () => Extraction = goodExtraction, private failTimes = 0) {}
  async extract() {
    this.calls++
    if (this.failTimes-- > 0) throw new Error("API caiu")
    return this.result()
  }
}

const invite: GoogleEvent = {
  id: "evt-1",
  etag: '"1"',
  summary: "Diagnóstico Acme",
  created: "2026-10-01T12:00:00.000Z",
  start: { dateTime: "2026-10-10T13:00:00-03:00" },
  end: { dateTime: "2026-10-10T14:00:00-03:00" },
  organizer: { email: "gabriel@lumeis.ai", self: true },
  attendees: [
    { email: "gabriel@lumeis.ai", displayName: "Gabriel Monteiro", self: true, organizer: true },
    { email: "joao@acme.com.br", displayName: "João Silva" },
  ],
}

let store: MemoryHubStore
beforeEach(async () => {
  store = new MemoryHubStore()
  store.addCompany({ id: ACME, name: "Acme", stageTitle: "Diagnóstico" })
  store.domains.set("acme.com.br", { domain: "acme.com.br", companyId: ACME, ignored: false })
  await ingestGoogleEvent(store, invite, INTERNAL)
})

describe("evidência literal", () => {
  it("aceita citação que está no texto, com acento e caixa diferentes", () => {
    const lines = [{ segment: 1, speaker: "x", text: "Quanto CUSTARIA um piloto?" }]
    expect(quoteIsLiteral({ segment: 1, speaker: "x", quote: "quanto custaria um piloto" }, lines)).toBe(true)
  })
  it("recusa citação inventada ou curta demais", () => {
    const lines = [{ segment: 1, speaker: "x", text: "Quanto custaria um piloto?" }]
    expect(quoteIsLiteral({ segment: 1, speaker: "x", quote: "fechamos o contrato" }, lines)).toBe(false)
    expect(quoteIsLiteral({ segment: 1, speaker: "x", quote: "piloto" }, lines)).toBe(false)
  })
  it("verifyExtraction derruba o sinal inventado e mantém o resto", () => {
    const lines = LINES.map((l) => ({ segment: l.index, speaker: "?", text: l.text }))
    const { extraction, dropped } = verifyExtraction(goodExtraction(), lines)
    expect(extraction.signals.map((s) => s.type)).toEqual(["asked_price"])
    expect(dropped).toEqual([{ field: "signal:shared_real_data", reason: "citacao_nao_literal" }])
    expect(extraction.next_steps).toHaveLength(2)
  })
  it("prazo sem data válida vira passo sem prazo", () => {
    const lines = LINES.map((l) => ({ segment: l.index, speaker: "?", text: l.text }))
    const raw = goodExtraction()
    raw.next_steps[1].due_date = "sexta"
    const { extraction } = verifyExtraction(raw, lines)
    expect(extraction.next_steps[1]).toMatchObject({ due_date: null, due_basis: "none" })
  })
})

describe("quem agiu na reunião", () => {
  it("uma voz só (você ditando) não conta como cliente", () => {
    const b = bundle({ utterances: [{ speaker_id: "sp-g", index: 0, text: "x".repeat(5000) }] })
    expect(clientSpokenChars(b, new Set())).toBe(0)
  })
  it("conta a fala de quem não é da Lumeis", () => {
    const b = bundle()
    expect(clientSpokenChars(b, new Set(["sp-g"]))).toBeGreaterThan(300)
  })
})

describe("ingestão da reunião", () => {
  it("liga ao convite e à empresa, reseta o contador NA DATA DA REUNIÃO, aplica com evidência", async () => {
    const extractor = new CountingExtractor()
    const r = await ingestMeeting(store, new FakeSource([bundle()]), extractor, "m-1", INTERNAL)

    expect(r).toMatchObject({ status: "linked", companies: [ACME], extracted: true, dropped: 1 })
    const held = [...store.events.values()].find((e) => e.kind === "meeting.held")!
    expect(held).toMatchObject({ clientEngaged: true, engagementRule: "meeting.client_spoke", occurredAt: "2026-10-10T16:02:00.000Z" })
    expect(store.companies.get(ACME)!.lastClientEventAt).toBe("2026-10-10T16:02:00.000Z")

    const acme = store.companies.get(ACME)!
    expect(acme.championName).toBe("João Silva")
    expect(acme.painHypothesis).toMatch(/Conciliação/)
    expect(acme.contextInferenceIds).toHaveProperty("champion_name")
    expect([...store.signals.keys()]).toEqual([`${ACME}|asked_price`])
    expect(store.nextSteps.size).toBe(2)

    const stage = [...store.inferences.values()].find((i) => i.field === "stage_suggestion")!
    expect(stage.status).toBe("proposed") // nunca aplica estágio
    const sig = [...store.inferences.values()].find((i) => i.field === "signal:asked_price")!
    expect(sig.evidence[0]).toMatchObject({ kind: "transcript", ref: "m-1", quote: "Quanto custaria um piloto de três meses" })
  })

  it("IDEMPOTÊNCIA: reprocessar a mesma transcrição não duplica nada nem gasta modelo", async () => {
    const extractor = new CountingExtractor()
    const src = new FakeSource([bundle()])
    await ingestMeeting(store, src, extractor, "m-1", INTERNAL)
    const snapshot = () => [store.events.size, store.inferences.size, store.nextSteps.size, store.signals.size, store.participants.size]
    const before = snapshot()
    await ingestMeeting(store, src, extractor, "m-1", INTERNAL)
    await ingestMeeting(store, src, extractor, "m-1", INTERNAL)
    expect(snapshot()).toEqual(before)
    expect(extractor.calls).toBe(1)
  })

  it("versão nova da transcrição reextrai sem duplicar passos, e não sobrescreve o que já foi aplicado", async () => {
    const extractor = new CountingExtractor()
    const src = new FakeSource([bundle()])
    await ingestMeeting(store, src, extractor, "m-1", INTERNAL)
    src.bundles = [bundle({ transcript_version: "v2", updated_at: "2026-10-10T18:00:00+00:00" })]
    await ingestMeeting(store, src, extractor, "m-1", INTERNAL)

    expect(extractor.calls).toBe(2)
    expect([...store.events.values()].filter((e) => e.kind === "meeting.held")).toHaveLength(1)
    expect(store.nextSteps.size).toBe(2)
    const stages = [...store.inferences.values()].filter((i) => i.field === "stage_suggestion")
    expect(stages.map((s) => s.status).sort()).toEqual(["proposed", "superseded"])
  })

  it("campo preenchido à mão vira proposta, nunca sobrescrita", async () => {
    store.companies.get(ACME)!.championName = "Maria Souza"
    await ingestMeeting(store, new FakeSource([bundle()]), new CountingExtractor(), "m-1", INTERNAL)
    expect(store.companies.get(ACME)!.championName).toBe("Maria Souza")
    const champ = [...store.inferences.values()].find((i) => i.field === "champion")!
    expect(champ).toMatchObject({ status: "proposed", value: { value: "João Silva", previous: "Maria Souza" } })
  })

  it("reunião antiga reprocessada não rejuvenesce a conta", async () => {
    store.companies.get(ACME)!.lastClientEventAt = "2026-10-20T10:00:00.000Z"
    await ingestMeeting(store, new FakeSource([bundle()]), new CountingExtractor(), "m-1", INTERNAL)
    expect(store.companies.get(ACME)!.lastClientEventAt).toBe("2026-10-20T10:00:00.000Z")
  })

  it("reunião só com a sua voz entra na timeline, mas não reseta o contador", async () => {
    const solo = bundle({ utterances: [{ speaker_id: "sp-g", index: 0, text: "notas ditadas ".repeat(100) }] })
    await ingestMeeting(store, new FakeSource([solo]), new CountingExtractor(), "m-1", INTERNAL)
    const held = [...store.events.values()].find((e) => e.kind === "meeting.held")!
    expect(held).toMatchObject({ clientEngaged: false, engagementRule: "meeting.no_client_evidence" })
    expect(store.companies.get(ACME)!.lastClientEventAt).toBeUndefined()
  })

  it("sem event id, casa pelo horário com o único convite sobreposto", async () => {
    const r = await ingestMeeting(store, new FakeSource([bundle({ google_calendar_event_id: null })]), new CountingExtractor(), "m-1", INTERNAL)
    expect(r.status).toBe("linked")
  })

  it("sem convite nenhum → fila, nada escrito na conta", async () => {
    const r = await ingestMeeting(
      store,
      new FakeSource([bundle({ google_calendar_event_id: null, started_at: "2026-09-01T10:00:00Z", ended_at: "2026-09-01T11:00:00Z" })]),
      new CountingExtractor(),
      "m-1",
      INTERNAL
    )
    expect(r.status).toBe("no_calendar_event")
    expect([...store.events.values()].some((e) => e.kind === "meeting.held")).toBe(false)
    expect([...store.reviews.values()].some((v) => v.reason === "reuniao_sem_convite")).toBe(true)
  })

  it("reunião ainda gravando é ignorada", async () => {
    const r = await ingestMeeting(store, new FakeSource([bundle({ status: "recording" })]), new CountingExtractor(), "m-1", INTERNAL)
    expect(r.status).toBe("skipped_incomplete")
  })
})

describe("sync com cursor", () => {
  const NOW = Date.parse("2026-10-20T12:00:00Z")
  const opts = { now: () => NOW }

  it("falha de extração segura o cursor; a próxima rodada refaz só o que falhou", async () => {
    const src = new FakeSource([
      bundle(),
      bundle({ id: "m-2", updated_at: "2026-10-11T10:00:00+00:00", google_calendar_event_id: "evt-1" }),
    ])
    const extractor = new CountingExtractor(goodExtraction, 1) // a primeira chamada falha
    const first = await syncTranscripts(store, src, extractor, INTERNAL, opts)
    expect(first.failed.map((f) => f.meetingId)).toEqual(["m-1"])
    expect(first.cursor).toBe("2026-10-10T17:05:00+00:00")

    const second = await syncTranscripts(store, src, extractor, INTERNAL, opts)
    expect(second.failed).toEqual([])
    expect(second.cursor).toBe("2026-10-11T10:00:00+00:00")
    // m-1 falhou e foi refeita; m-2 deu certo na primeira e não gastou modelo de novo.
    expect(extractor.calls).toBe(3)
  })

  it("primeira rodada sem cursor ignora reunião anterior à janela de 30 dias", async () => {
    const src = new FakeSource([
      bundle({ id: "m-velha", updated_at: "2026-02-16T10:00:00+00:00", google_calendar_event_id: null }),
      bundle(),
    ])
    const r = await syncTranscripts(store, src, new CountingExtractor(), INTERNAL, opts)
    expect(r.processed.map((p) => p.meetingId)).toEqual(["m-1"])
    expect([...store.reviews.values()].some((v) => v.reason === "reuniao_sem_convite")).toBe(false)
    expect(r.cursor).toBe("2026-10-10T17:05:00+00:00")
  })

  it("orçamento estourado para no meio e a próxima rodada continua de onde parou", async () => {
    const src = new FakeSource([
      bundle(),
      bundle({ id: "m-2", updated_at: "2026-10-11T10:00:00+00:00" }),
      bundle({ id: "m-3", updated_at: "2026-10-12T10:00:00+00:00" }),
    ])
    let t = NOW
    const clock = { now: () => t, budgetMs: 1000 }
    const extractor = new CountingExtractor()
    // Cada extração "leva" 600 ms: cabem duas antes de o orçamento estourar.
    const slow: Extractor = { extract: async () => { t += 600; return extractor.extract() } }
    const first = await syncTranscripts(store, src, slow, INTERNAL, clock)
    expect(first.processed.map((p) => p.meetingId)).toEqual(["m-1", "m-2"])
    expect(first.cursor).toBe("2026-10-11T10:00:00+00:00")

    t = NOW
    const second = await syncTranscripts(store, src, slow, INTERNAL, clock)
    // m-2 volta (updated_since é inclusivo) sem gastar modelo; m-3 é extraída.
    expect(second.processed.map((p) => p.meetingId)).toEqual(["m-2", "m-3"])
    expect(second.cursor).toBe("2026-10-12T10:00:00+00:00")
    expect(extractor.calls).toBe(3)
  })
})
