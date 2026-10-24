import { describe, it, expect, beforeEach } from "vitest"
import { MemoryHubStore } from "./memory-store"
import { buildDirectory, openCandidates, recordDays } from "./whatsapp-ingest"
import type { WaDayEvent } from "@/lib/whatsapp/contract"

const ACME = "co-acme"
let store: MemoryHubStore
let joaoId: string

beforeEach(async () => {
  store = new MemoryHubStore()
  store.addCompany({ id: ACME, name: "Acme Ltda" })
  store.funnelCompanyIds.add(ACME)
  store.addCompany({ id: "co-fora", name: "Fora do Funil" })
  const joao = await store.createPerson({ firstName: "João", lastName: "Silva", companyId: ACME, currentCompany: "Acme", email: null })
  joaoId = joao.id
  await store.createPerson({ firstName: "Ana", lastName: "—", companyId: ACME, currentCompany: "Acme", email: null })
})

const day = (over: Partial<WaDayEvent> = {}): WaDayEvent => ({
  chatKey: "p:+5521987654321",
  chat: { type: "direct", phone: "+5521987654321" },
  chatName: "João Silva",
  day: "2026-10-22",
  direction: "received",
  messageCount: 2,
  lastAt: "2026-10-22T17:40:00.000Z",
  text: "14:30 João Silva: segue o export\n14:40 João Silva: falamos quinta?",
  lastMessage: { id: "wamid-2", quote: "falamos quinta?" },
  speakerPhones: ["+5521987654321"],
  ...over,
})

const confirmPhone = () =>
  store.addIdentity({ personId: joaoId, kind: "phone", valueNorm: "+5521987654321", source: "review", confidence: "confirmed" })

describe("diretório", () => {
  it("leva pessoas com nome e sobrenome, empresas do funil, telefones com variantes e grupos", async () => {
    await confirmPhone()
    await store.linkWhatsappGroup("120@g.us", "Lumeis <> Acme", ACME, false)
    const d = await buildDirectory(store)
    expect(d.people).toEqual([{ id: joaoId, nameKey: "joao silva", companyId: ACME }])
    expect(d.companies).toEqual([{ id: ACME, nameKey: "acme" }])
    expect(d.phones).toEqual([{ digits: ["5521987654321", "552187654321"], personId: joaoId, ignored: false }])
    expect(d.groups).toEqual([{ groupId: "120@g.us", companyId: ACME, ignored: false }])
  })
})

describe("candidatos", () => {
  it("abre um caso por telefone, só com nome e número, e não duplica", async () => {
    const c = { type: "direct" as const, phone: "+5521987654321", contactName: "João Silva", personIds: [joaoId] }
    expect(await openCandidates(store, [c, c])).toEqual({ opened: 1, skipped: 1 })
    const [r] = [...store.reviews.values()]
    expect(r.reason).toBe("whatsapp_contato")
    expect(r.observed).toEqual({ source: "whatsapp", phone: "+5521987654321", name: "João Silva" })
    expect(r.candidates.map((x) => x.personId)).toEqual([joaoId])
  })

  it("grupo vira grupo_sem_empresa; id de candidato que não existe é descartado", async () => {
    await openCandidates(store, [
      { type: "group", groupId: "120@g.us", groupName: "Lumeis <> Acme", companyIds: [ACME, "co-inventada"], matchedBy: "nome" },
    ])
    const [r] = [...store.reviews.values()]
    expect(r.reason).toBe("grupo_sem_empresa")
    expect(r.observed).toEqual({ source: "whatsapp", group_id: "120@g.us", group_name: "Lumeis <> Acme" })
    expect(r.candidates.map((x) => x.companyId)).toEqual([ACME])
  })

  it("telefone já decidido não abre caso", async () => {
    await confirmPhone()
    const r = await openCandidates(store, [{ type: "direct", phone: "+5521987654321", contactName: "João Silva", personIds: [] }])
    expect(r).toEqual({ opened: 0, skipped: 1 })
  })
})

describe("eventos do dia", () => {
  it("conversa não confirmada é recusada e nada é gravado", async () => {
    const r = await recordDays(store, [day()])
    expect(r).toEqual({ recorded: 0, rejected: [{ chatKey: "p:+5521987654321", day: "2026-10-22", reason: "conversa_nao_confirmada" }] })
    expect(store.events.size).toBe(0)
  })

  it("cliente escreveu: whatsapp.received, reseta na hora da última mensagem dele", async () => {
    await confirmPhone()
    expect((await recordDays(store, [day()])).recorded).toBe(1)
    const [ev] = [...store.events.values()]
    expect(ev).toMatchObject({
      source: "whatsapp",
      sourceId: "p:+5521987654321:2026-10-22",
      sourceVersion: "2",
      kind: "whatsapp.received",
      companyId: ACME,
      direction: "inbound",
      clientEngaged: true,
      engagementRule: "wa.inbound",
      title: "WhatsApp: João Silva",
      conversationKey: "whatsapp:p:+5521987654321",
    })
    expect(ev.evidence[0]).toMatchObject({ kind: "whatsapp", ref: "wamid-2", quote: "falamos quinta?", locator: "João Silva às 14:40" })
    expect(store.companies.get(ACME)!.lastClientEventAt).toBe("2026-10-22T17:40:00.000Z")
  })

  it("IDEMPOTÊNCIA: o mesmo agregado duas vezes, um evento; com mais mensagens, atualiza", async () => {
    await confirmPhone()
    await recordDays(store, [day()])
    await recordDays(store, [day()])
    expect(store.events.size).toBe(1)
    await recordDays(store, [day({ messageCount: 3, text: "…\n15:00 João Silva: e o preço?" })])
    expect(store.events.size).toBe(1)
    expect([...store.events.values()][0].sourceVersion).toBe("3")
  })

  it("você escreveu: whatsapp.sent, outro evento, não reseta", async () => {
    await confirmPhone()
    await recordDays(store, [day({ direction: "sent", lastMessage: { id: "wamid-9", quote: "fechado" }, speakerPhones: [] })])
    const [ev] = [...store.events.values()]
    expect(ev).toMatchObject({ kind: "whatsapp.sent", direction: "outbound", clientEngaged: false, title: "WhatsApp enviado: João Silva" })
    expect(store.companies.get(ACME)!.lastClientEventAt).toBeUndefined()
  })

  it("grupo ligado: vai para a empresa do grupo; grupo ignorado é recusado", async () => {
    await store.linkWhatsappGroup("120@g.us", "Lumeis <> Acme", ACME, false)
    await store.linkWhatsappGroup("999@g.us", "Família", null, true)
    const g = (id: string) => day({ chatKey: `g:${id}`, chat: { type: "group", groupId: id }, chatName: "Lumeis <> Acme", speakerPhones: [] })
    const r = await recordDays(store, [g("120@g.us"), g("999@g.us")])
    expect(r.recorded).toBe(1)
    expect(r.rejected.map((x) => x.reason)).toEqual(["grupo_ignorado"])
    expect([...store.events.values()][0].companyId).toBe(ACME)
  })
})
