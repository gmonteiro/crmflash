import { describe, it, expect, beforeEach } from "vitest"
import { MemoryHubStore } from "./memory-store"
import { recordEvent } from "@/lib/events/record"
import { openItems } from "./open-items"
import type { EventKind } from "@/lib/events/types"

const NOW = Date.parse("2026-10-24T15:00:00Z")
const H = 3_600_000
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()
let store: MemoryHubStore

beforeEach(() => {
  store = new MemoryHubStore()
  store.addCompany({ id: "co-acme", name: "Acme" })
})

let seq = 0
async function msg(conversationKey: string, kind: EventKind, agoMs: number, over: { fromClient?: boolean; autoReply?: boolean } = {}) {
  const source = conversationKey.startsWith("gmail:") ? "gmail" : "whatsapp"
  await recordEvent(store, {
    source,
    sourceId: `m${++seq}`,
    kind,
    companyId: "co-acme",
    occurredAt: iso(agoMs),
    direction: kind.endsWith(".sent") ? "outbound" : "inbound",
    title: `${kind} ${seq}`,
    description: `texto ${seq}`,
    facts: { fromClient: over.fromClient ?? true, autoReply: over.autoReply ?? false },
    evidence: [{ kind: source === "gmail" ? "email" : "whatsapp", ref: `m${seq}`, url: source === "gmail" ? `https://mail.google.com/mail/u/0/#all/${conversationKey.slice(6)}` : undefined }],
    conversationKey,
  })
}
const run = () => openItems(store, { now: NOW })

describe("aguardando você", () => {
  it("cliente escreveu por último: aparece, com a idade da última mensagem dele", async () => {
    await msg("gmail:t1", "email.sent", 30 * H)
    await msg("gmail:t1", "email.received", 5 * H)
    const r = await run()
    expect(r.waitingYou.map((x) => [x.conversationKey, x.channel, x.ageHours])).toEqual([["gmail:t1", "gmail", 5]])
    expect(r.waitingYou[0]).toMatchObject({ companyName: "Acme", url: "https://mail.google.com/mail/u/0/#all/t1", preview: "texto 2" })
    expect(r.waitingClient).toEqual([])
  })

  it("Lumeis respondeu depois: sai da lista", async () => {
    await msg("whatsapp:p:+5521987654321", "whatsapp.received", 5 * H)
    await msg("whatsapp:p:+5521987654321", "whatsapp.sent", 4 * H)
    expect((await run()).waitingYou).toEqual([])
  })

  it("é por conversa: duas threads da mesma conta são duas pendências, a mais antiga primeiro", async () => {
    await msg("gmail:t1", "email.received", 2 * H)
    await msg("gmail:t2", "email.received", 9 * H)
    expect((await run()).waitingYou.map((x) => x.conversationKey)).toEqual(["gmail:t2", "gmail:t1"])
  })

  it("resposta automática não conta como cliente", async () => {
    await msg("gmail:t1", "email.sent", 100 * H)
    await msg("gmail:t1", "email.auto_reply", 1 * H, { autoReply: true })
    const r = await run()
    expect(r.waitingYou).toEqual([])
    expect(r.waitingClient.map((x) => x.conversationKey)).toEqual(["gmail:t1"])
  })

  it("dispensar tira; mensagem nova do cliente depois traz de volta", async () => {
    await msg("gmail:t1", "email.received", 5 * H)
    await store.dismissConversation({ conversationKey: "gmail:t1", side: "client", dismissedThrough: iso(5 * H), reason: "era obrigado", dismissedBy: null })
    expect((await run()).waitingYou).toEqual([])
    await msg("gmail:t1", "email.received", 1 * H)
    expect((await run()).waitingYou.map((x) => x.ageHours)).toEqual([1])
  })

  it("conversa fora dos 30 dias não aparece", async () => {
    await msg("gmail:velha", "email.received", 31 * 24 * H)
    expect((await run()).waitingYou).toEqual([])
  })
})

describe("aguardando o cliente", () => {
  it("só depois de 3 dias", async () => {
    await msg("gmail:t1", "email.sent", 71 * H)
    await msg("gmail:t2", "email.sent", 73 * H)
    expect((await run()).waitingClient.map((x) => x.conversationKey)).toEqual(["gmail:t2"])
  })

  it("parar de esperar tira", async () => {
    await msg("gmail:t2", "email.sent", 100 * H)
    await store.dismissConversation({ conversationKey: "gmail:t2", side: "lumeis", dismissedThrough: iso(100 * H), reason: null, dismissedBy: null })
    expect((await run()).waitingClient).toEqual([])
  })
})

describe("decisões", () => {
  it("casos da fila (com e sem empresa) e propostas; projeto e estágio não se decidem na página", async () => {
    await store.openReview({ dedupKey: "a", companyId: null, reason: "dominio_desconhecido", observed: { domain: "novaco.com", source: "gmail" }, candidates: [] })
    await store.openReview({ dedupKey: "b", companyId: null, reason: "projeto_sem_empresa", observed: { project_id: "p1", project_name: "Piloto" }, candidates: [] })
    await store.insertInference({ companyId: "co-acme", field: "stage_suggestion", value: { target_stage: "Prova" }, evidence: [], sourceActivityId: "x", sourceVersion: "1", model: "m", promptVersion: "p", status: "proposed" })
    await store.insertInference({ companyId: "co-acme", field: "pain_hypothesis", value: { value: "conciliação manual" }, evidence: [], sourceActivityId: "x", sourceVersion: "1", model: "m", promptVersion: "p", status: "proposed" })
    const d = (await run()).decisions
    expect(d.map((x) => [x.kind, x.title, x.decidableHere])).toEqual([
      ["identity", "Domínio novo: novaco.com", true],
      ["identity", "Projeto do TranscriptionApp sem empresa: Piloto", false],
      ["proposal", "Acme: mover para Prova", false],
      ["proposal", "Acme: dor — conciliação manual", true],
    ])
  })
})

describe("sistema", () => {
  it("batimento do WhatsApp velho e cron parado alertam; cron que nunca rodou não", async () => {
    await store.setCursor("whatsapp", iso(30 * H), "heartbeat")
    await store.setCursor("cron", iso(27 * H), "gmail-sync")
    await store.setCursor("cron", iso(2 * H), "calendar-sync")
    const s = (await run()).system
    expect(s.map((x) => x.key)).toEqual(["whatsapp-heartbeat", "cron:gmail-sync"])
    expect(s[1].message).toContain("gmail-sync")
  })
})
