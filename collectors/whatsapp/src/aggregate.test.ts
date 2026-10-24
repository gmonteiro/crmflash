import { describe, it, expect } from "vitest"
import { aggregateDays, TEXT_LIMIT, type WaMessage } from "./aggregate"

const T = (iso: string) => Date.parse(iso) / 1000
const m = (over: Partial<WaMessage>): WaMessage => ({
  id: "x",
  timestamp: T("2026-10-22T17:30:00Z"),
  fromMe: false,
  authorDigits: "5521900000001",
  authorName: "João Silva",
  type: "chat",
  body: "oi",
  fileName: null,
  ...over,
})
const CHAT = { type: "direct" as const, phone: "+5521900000001" }
const INTERNAL = new Set(["5521988887777"])

describe("agregado do dia", () => {
  it("os dois lados no mesmo dia viram dois eventos, cada um com a sua última mensagem", () => {
    const evs = aggregateDays("p:+5521900000001", CHAT, "João Silva", [
      m({ id: "a", body: "segue o export" }),
      m({ id: "b", fromMe: true, authorDigits: null, authorName: "Gabriel", timestamp: T("2026-10-22T17:35:00Z"), body: "valeu" }),
      m({ id: "c", timestamp: T("2026-10-22T17:40:00Z"), body: "falamos quinta?" }),
    ], INTERNAL)
    expect(evs.map((e) => [e.direction, e.messageCount, e.lastMessage.id, e.lastAt])).toEqual([
      ["received", 2, "c", "2026-10-22T17:40:00.000Z"],
      ["sent", 1, "b", "2026-10-22T17:35:00.000Z"],
    ])
    expect(evs[0].text).toBe("14:30 João Silva: segue o export\n14:35 Gabriel: valeu\n14:40 João Silva: falamos quinta?")
    expect(evs[0].text).toBe(evs[1].text)
    expect(evs[0].speakerPhones).toEqual(["+5521900000001"])
    expect(evs[0].day).toBe("2026-10-22")
  })

  it("colega da Lumeis num grupo conta como enviado", () => {
    const evs = aggregateDays("g:1@g.us", { type: "group", groupId: "1@g.us" }, "Lumeis <> Acme", [
      m({ id: "r", authorDigits: "5521988887777", authorName: "Rafa" }),
    ], INTERNAL)
    expect(evs.map((e) => e.direction)).toEqual(["sent"])
  })

  it("mídia vira marcador; apagada e de sistema saem", () => {
    const evs = aggregateDays("p:+5521900000001", CHAT, "João Silva", [
      m({ id: "1", type: "ptt", body: "" }),
      m({ id: "2", type: "document", body: "", fileName: "proposta.pdf" }),
      m({ id: "3", type: "revoked", body: "" }),
      m({ id: "4", type: "e2e_notification", body: "" }),
    ], INTERNAL)
    expect(evs[0].messageCount).toBe(2)
    expect(evs[0].text).toBe("14:30 João Silva: [áudio]\n14:30 João Silva: [arquivo: proposta.pdf]")
  })

  it("virada do dia em São Paulo separa os eventos", () => {
    const evs = aggregateDays("p:+5521900000001", CHAT, "João Silva", [
      m({ id: "1", timestamp: T("2026-10-23T02:50:00Z") }), // 23:50 do dia 22 em SP
      m({ id: "2", timestamp: T("2026-10-23T03:10:00Z") }), // 00:10 do dia 23 em SP
    ], INTERNAL)
    expect(evs.map((e) => e.day)).toEqual(["2026-10-22", "2026-10-23"])
  })

  it("texto longo corta o começo e mantém o fim; citação ≤ 280", () => {
    const long = Array.from({ length: 200 }, (_, i) => m({ id: `l${i}`, body: `mensagem ${i} ` + "x".repeat(40) }))
    const [ev] = aggregateDays("p:+5521900000001", CHAT, "João Silva", long, INTERNAL)
    expect(ev.text.length).toBeLessThanOrEqual(TEXT_LIMIT)
    expect(ev.text.startsWith("…")).toBe(true)
    expect(ev.text.endsWith("mensagem 199 " + "x".repeat(40))).toBe(true)
    const [big] = aggregateDays("p:+5521900000001", CHAT, "João Silva", [m({ body: "y".repeat(1000) })], INTERNAL)
    expect(big.lastMessage.quote.length).toBe(280)
  })
})
