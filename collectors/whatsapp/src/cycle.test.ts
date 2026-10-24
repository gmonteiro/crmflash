import { describe, it, expect } from "vitest"
import type { WaCandidate, WaDayEvent, WaDirectory } from "../../../src/lib/whatsapp/contract"
import { runCycle, type CrmApi, type CycleState, type WaSource } from "./cycle"
import type { WaMessage } from "./aggregate"

const NOW = Date.parse("2026-10-23T15:00:00Z")
const T = (iso: string) => Date.parse(iso) / 1000

const DIR: WaDirectory = {
  generatedAt: "x",
  people: [{ id: "p-joao", nameKey: "joao silva", companyId: "c-acme" }],
  companies: [],
  phones: [{ digits: ["5521900000001"], personId: "p-joao", ignored: false }],
  groups: [],
}

class FakeCrm implements CrmApi {
  sentCandidates: WaCandidate[] = []
  sentEvents: WaDayEvent[] = []
  eventCalls = 0
  async directory() {
    return DIR
  }
  async candidates(list: WaCandidate[]) {
    this.sentCandidates.push(...list)
    return { opened: list.length, skipped: 0 }
  }
  async events(list: WaDayEvent[]) {
    this.eventCalls++
    this.sentEvents.push(...list)
    return { recorded: list.length, rejected: [] }
  }
}

const msg = (id: string, iso: string, fromMe = false): WaMessage => ({
  id,
  timestamp: T(iso),
  fromMe,
  authorDigits: fromMe ? null : "5521900000001",
  authorName: fromMe ? "Gabriel" : "João Silva",
  type: "chat",
  body: id,
  fileName: null,
})

function source(): WaSource & { asked: [string, number][] } {
  const box: Record<string, WaMessage[]> = {
    joao: [msg("m1", "2026-10-20T13:00:00Z"), msg("m2", "2026-10-23T14:00:00Z")],
    pessoal: [msg("x1", "2026-10-23T14:00:00Z")],
    nova: [msg("n1", "2026-10-23T14:00:00Z")],
  }
  const asked: [string, number][] = []
  return {
    asked,
    async listChats() {
      return [
        { id: "joao", type: "direct", phoneDigits: "5521900000001", groupId: null, name: "João", participantDigits: [], lastActivity: T("2026-10-23T14:00:00Z") },
        { id: "pessoal", type: "direct", phoneDigits: "5521977776666", groupId: null, name: "Mãe", participantDigits: [], lastActivity: T("2026-10-23T14:00:00Z") },
        { id: "nova", type: "direct", phoneDigits: "5521955554444", groupId: null, name: "João Silva", participantDigits: [], lastActivity: T("2026-10-23T14:00:00Z") },
        { id: "velha", type: "direct", phoneDigits: "5521900000001", groupId: null, name: "João", participantDigits: [], lastActivity: T("2026-08-01T14:00:00Z") },
      ]
    },
    async messagesSince(chatId: string, since: number) {
      asked.push([chatId, since])
      return (box[chatId] ?? []).filter((m) => m.timestamp >= since)
    },
  }
}
const fresh = (): CycleState => ({ sent: {}, proposed: [], lastBeatMs: 0 })

describe("ciclo do coletor", () => {
  it("só lê mensagem de conversa vinculada; pessoal nunca é lida nem enviada", async () => {
    const src = source()
    const crm = new FakeCrm()
    const r = await runCycle(src, crm, fresh(), { now: NOW, internalDigits: new Set() })
    expect(src.asked.map(([id]) => id)).toEqual(["joao"])
    expect(crm.sentEvents.every((e) => e.chatKey === "p:+5521900000001")).toBe(true)
    expect(r).toMatchObject({ linked: 1, candidates: 1 })
    expect(crm.sentCandidates).toEqual([{ type: "direct", phone: "+5521955554444", contactName: "João Silva", personIds: ["p-joao"] }])
  })

  it("primeira vez: backfill de 30 dias; depois, só o que mudou, sem reenviar candidato", async () => {
    const src = source()
    const crm = new FakeCrm()
    const state = fresh()
    await runCycle(src, crm, state, { now: NOW, internalDigits: new Set() })
    expect(src.asked[0][1]).toBe(Math.floor((NOW - 30 * 86_400_000) / 1000))
    expect(crm.sentEvents.map((e) => e.day)).toEqual(["2026-10-20", "2026-10-23"])
    expect(state.sent["p:+5521900000001"]).toBe(T("2026-10-23T14:00:00Z"))

    src.asked.length = 0
    crm.sentEvents = []
    crm.sentCandidates = []
    await runCycle(src, crm, state, { now: NOW + 5 * 60_000, internalDigits: new Set() })
    expect(src.asked).toEqual([])
    expect(crm.sentCandidates).toEqual([])
  })

  it("mensagem nova reenvia o dia inteiro dela (o CRM atualiza pela versão)", async () => {
    const src = source()
    const crm = new FakeCrm()
    const state: CycleState = { sent: { "p:+5521900000001": T("2026-10-23T12:00:00Z") }, proposed: [], lastBeatMs: NOW }
    await runCycle(src, crm, state, { now: NOW, internalDigits: new Set() })
    // Começo do dia 23 em São Paulo = 03:00 UTC.
    expect(src.asked).toEqual([["joao", T("2026-10-23T03:00:00Z")]])
    expect(crm.sentEvents.map((e) => e.day)).toEqual(["2026-10-23"])
  })

  it("sem nada a enviar, bate o coração uma vez por hora", async () => {
    const crm = new FakeCrm()
    const src: WaSource = { listChats: async () => [], messagesSince: async () => [] }
    const state = fresh()
    await runCycle(src, crm, state, { now: NOW, internalDigits: new Set() })
    await runCycle(src, crm, state, { now: NOW + 10 * 60_000, internalDigits: new Set() })
    expect(crm.eventCalls).toBe(1)
    await runCycle(src, crm, state, { now: NOW + 61 * 60_000, internalDigits: new Set() })
    expect(crm.eventCalls).toBe(2)
  })

  it("CRM recusou ou caiu: o estado não avança", async () => {
    const src = source()
    const crm = new FakeCrm()
    crm.events = async () => {
      throw new Error("503")
    }
    const state = fresh()
    await expect(runCycle(src, crm, state, { now: NOW, internalDigits: new Set() })).rejects.toThrow("503")
    expect(state.sent).toEqual({})
  })
})
