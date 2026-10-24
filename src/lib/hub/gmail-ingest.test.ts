import { describe, it, expect, beforeEach } from "vitest"
import { MemoryHubStore } from "./memory-store"
import { ingestGmailMessage, syncGmail, type GmailSource } from "./gmail-ingest"
import { HistoryExpiredError, parseAddressList, parseMessage, type GmailMessage } from "@/lib/google/gmail"

const INTERNAL = new Set(["lumeis.ai"])
const ACME = "co-acme"

function msg(id: string, headers: Record<string, string>, over: Partial<GmailMessage> = {}): GmailMessage {
  return {
    id,
    threadId: `t-${id}`,
    internalDate: String(Date.parse("2026-10-20T14:30:00Z")),
    labelIds: ["INBOX", "CATEGORY_PERSONAL"],
    snippet: "Oi Gabriel, segue o export do ERP que você pediu. Podemos falar quinta?",
    payload: { headers: Object.entries(headers).map(([name, value]) => ({ name, value })) },
    ...over,
  }
}
const fromClient = (id = "m1", extra: Record<string, string> = {}) =>
  msg(id, { From: "João Silva <joao@acme.com.br>", To: "Gabriel <gabriel@lumeis.ai>", Subject: "Export do ERP", ...extra })

let store: MemoryHubStore
beforeEach(() => {
  store = new MemoryHubStore()
  store.addCompany({ id: ACME, name: "Acme" })
  store.domains.set("acme.com.br", { domain: "acme.com.br", companyId: ACME, ignored: false })
})
const events = () => [...store.events.values()]
const ingest = (m: GmailMessage) => ingestGmailMessage(store, parseMessage(m), INTERNAL)

describe("e-mail → evento", () => {
  it("cliente escreveu: email.received, reseta o contador na data do e-mail", async () => {
    await ingest(fromClient())
    expect(events()).toHaveLength(1)
    expect(events()[0]).toMatchObject({
      kind: "email.received",
      source: "gmail",
      companyId: ACME,
      direction: "inbound",
      clientEngaged: true,
      engagementRule: "email.inbound_human",
      occurredAt: "2026-10-20T14:30:00.000Z",
      conversationKey: "gmail:t-m1",
    })
    expect(store.companies.get(ACME)!.lastClientEventAt).toBe("2026-10-20T14:30:00.000Z")
    expect(store.people.size).toBe(1)
  })

  it("IDEMPOTÊNCIA: o mesmo e-mail três vezes, um evento", async () => {
    for (let i = 0; i < 3; i++) await ingest(fromClient())
    expect(events()).toHaveLength(1)
    expect(store.people.size).toBe(1)
  })

  it("resposta automática (ausência) entra, mas não reseta", async () => {
    await ingest(fromClient("m2", { "Auto-Submitted": "auto-replied", Subject: "Resposta automática: Export" }))
    expect(events()[0]).toMatchObject({ kind: "email.auto_reply", clientEngaged: false })
    expect(store.companies.get(ACME)!.lastClientEventAt).toBeUndefined()
  })

  it("newsletter e notificação são ignoradas, sem caso na fila", async () => {
    await ingest(msg("n1", { From: "Acme News <news@acme.com.br>", To: "gabriel@lumeis.ai", "List-Unsubscribe": "<mailto:x>" }))
    await ingest(msg("n2", { From: "noreply@novaempresa.com", To: "gabriel@lumeis.ai" }))
    await ingest(fromClient("n3"))
    const promo = msg("n4", { From: "joao@acme.com.br", To: "gabriel@lumeis.ai" }, { labelIds: ["CATEGORY_PROMOTIONS"] })
    await ingest(promo)
    expect(events().map((e) => e.sourceId)).toEqual(["n3"])
    expect(store.reviews.size).toBe(0)
  })

  it("você escreveu: email.sent para a conta do destinatário, sem resetar", async () => {
    await ingest(msg("s1", { From: "Gabriel <gabriel@lumeis.ai>", To: "joao@acme.com.br", Cc: "rafael@lumeis.ai", Subject: "Proposta" }))
    expect(events()[0]).toMatchObject({ kind: "email.sent", direction: "outbound", clientEngaged: false, companyId: ACME })
    expect(store.companies.get(ACME)!.lastClientEventAt).toBeUndefined()
  })

  it("enviado para domínio desconhecido não abre caso; recebido de empresa desconhecida abre", async () => {
    await ingest(msg("s2", { From: "gabriel@lumeis.ai", To: "ana@novaempresa.com", Subject: "Oi" }))
    expect(store.reviews.size).toBe(0)
    await ingest(msg("r2", { From: "Ana <ana@novaempresa.com>", To: "gabriel@lumeis.ai", Subject: "Re: Oi" }))
    expect([...store.reviews.values()].map((r) => r.reason)).toEqual(["dominio_desconhecido"])
    expect(events()).toHaveLength(0)
  })

  it("gmail pessoal desconhecido não abre caso", async () => {
    await ingest(msg("g1", { From: "Fulano <fulano@gmail.com>", To: "gabriel@lumeis.ai", Subject: "Oi" }))
    expect(store.reviews.size).toBe(0)
  })

  it("só gente da Lumeis na conversa: nada", async () => {
    await ingest(msg("i1", { From: "gabriel@lumeis.ai", To: "rafael@lumeis.ai", Subject: "interno" }))
    expect(events()).toHaveLength(0)
  })

  it("guarda só o snippet como evidência, com link para a conversa", async () => {
    await ingest(fromClient())
    const ev = events()[0]
    expect(ev.evidence[0]).toMatchObject({ kind: "email", ref: "m1", url: "https://mail.google.com/mail/u/0/#all/t-m1" })
    expect(ev.evidence[0].quote!.length).toBeLessThanOrEqual(280)
  })
})

describe("endereços", () => {
  it("vírgula dentro de aspas não separa", () => {
    expect(parseAddressList('"Silva, João" <joao@acme.com.br>, ana@x.com')).toEqual([
      { email: "joao@acme.com.br", name: "Silva, João" },
      { email: "ana@x.com", name: null },
    ])
  })
})

describe("sync do Gmail", () => {
  class FakeGmail implements GmailSource {
    gets = 0
    expired = false
    constructor(public box: GmailMessage[], public added: string[] = []) {}
    async profileHistoryId() {
      return "100"
    }
    async listIds() {
      return this.box.map((m) => m.id)
    }
    async history(start: string) {
      if (this.expired) throw new HistoryExpiredError("x")
      return { ids: start === "100" ? this.added : [], historyId: "200" }
    }
    async get(id: string) {
      this.gets++
      return this.box.find((m) => m.id === id) ?? null
    }
  }

  it("primeira rodada é carga cheia; a segunda é incremental e não duplica", async () => {
    const src = new FakeGmail([fromClient("a"), fromClient("b")], ["c"])
    const first = await syncGmail(store, src, INTERNAL)
    expect(first).toMatchObject({ fullSync: true, complete: true, events: 2 })
    src.box.push(fromClient("c"))
    const second = await syncGmail(store, src, INTERNAL)
    expect(second).toMatchObject({ fullSync: false, events: 1 })
    expect(events()).toHaveLength(3)
  })

  it("carga cheia que não cabe no orçamento continua de onde parou", async () => {
    const src = new FakeGmail([fromClient("a"), fromClient("b"), fromClient("c")])
    let t = 0
    const clock = { now: () => t, budgetMs: 1000 }
    const origGet = src.get.bind(src)
    src.get = async (id) => {
      t += 600
      return origGet(id)
    }
    const first = await syncGmail(store, src, INTERNAL, clock)
    expect(first).toMatchObject({ complete: false, pending: 1 })
    t = 0
    const second = await syncGmail(store, src, INTERNAL, clock)
    expect(second).toMatchObject({ complete: true, pending: 0, fullSync: false })
    expect(events()).toHaveLength(3)
  })

  it("historyId expirado refaz a carga cheia", async () => {
    const src = new FakeGmail([fromClient("a")])
    await syncGmail(store, src, INTERNAL)
    src.expired = true
    const r = await syncGmail(store, src, INTERNAL)
    expect(r.fullSync).toBe(true)
    expect(events()).toHaveLength(1)
  })
})
