import { describe, it, expect } from "vitest"
import { indexDirectory } from "./directory"
import { matchChat, type ChatInfo } from "./match"

const idx = indexDirectory({
  generatedAt: "x",
  people: [
    { id: "p-joao", nameKey: "joao silva", companyId: "c-acme" },
    { id: "p-ana1", nameKey: "ana souza", companyId: "c-acme" },
    { id: "p-ana2", nameKey: "ana souza", companyId: "c-beta" },
  ],
  companies: [
    { id: "c-acme", nameKey: "acme" },
    { id: "c-trigo", nameKey: "grupo trigo" },
  ],
  phones: [
    { digits: ["5521987654321", "552187654321"], personId: "p-joao", ignored: false },
    { digits: ["5521900000009"], personId: null, ignored: true },
  ],
  groups: [
    { groupId: "g-ligado@g.us", companyId: "c-acme", ignored: false },
    { groupId: "g-familia@g.us", companyId: null, ignored: true },
  ],
})
const direct = (phoneDigits: string | null, name: string | null): ChatInfo => ({ type: "direct", phoneDigits, groupId: null, name, participantDigits: [] })
const group = (groupId: string, name: string, participantDigits: string[] = []): ChatInfo => ({ type: "group", phoneDigits: null, groupId, name, participantDigits })

describe("1:1", () => {
  it("telefone confirmado: vinculada, por qualquer variante", () => {
    expect(matchChat(direct("552187654321", "Qualquer"), idx)).toEqual({
      status: "linked",
      chatKey: "p:+5521987654321",
      chat: { type: "direct", phone: "+5521987654321" },
    })
  })
  it("telefone ignorado: ignorada", () => {
    expect(matchChat(direct("5521900000009", "João Silva"), idx).status).toBe("ignored")
  })
  it("nome salvo igual ao do CRM: candidata, só com nome e número", () => {
    expect(matchChat(direct("5521911112222", "JOÃO silva"), idx)).toEqual({
      status: "candidate",
      chatKey: "p:+5521911112222",
      candidate: { type: "direct", phone: "+5521911112222", contactName: "JOÃO silva", personIds: ["p-joao"] },
    })
  })
  it("homônimos: candidata com os dois", () => {
    const r = matchChat(direct("5521933334444", "Ana Souza"), idx)
    expect(r.status === "candidate" && r.candidate.type === "direct" && r.candidate.personIds).toEqual(["p-ana1", "p-ana2"])
  })
  it("só primeiro nome, sem nome salvo ou sem número: ignorada", () => {
    expect(matchChat(direct("5521955556666", "João"), idx).status).toBe("ignored")
    expect(matchChat(direct("5521955556666", null), idx).status).toBe("ignored")
    expect(matchChat(direct(null, "João Silva"), idx).status).toBe("ignored")
  })
})

describe("grupo", () => {
  it("já ligado: vinculado; ignorado: ignorado", () => {
    expect(matchChat(group("g-ligado@g.us", "qualquer"), idx)).toEqual({
      status: "linked",
      chatKey: "g:g-ligado@g.us",
      chat: { type: "group", groupId: "g-ligado@g.us" },
    })
    expect(matchChat(group("g-familia@g.us", "Lumeis <> Acme"), idx).status).toBe("ignored")
  })
  it("nome do grupo contém o da empresa, como palavra inteira", () => {
    const r = matchChat(group("g-novo@g.us", "Lumeis <> Grupo Trigo | Piloto"), idx)
    expect(r).toEqual({
      status: "candidate",
      chatKey: "g:g-novo@g.us",
      candidate: { type: "group", groupId: "g-novo@g.us", groupName: "Lumeis <> Grupo Trigo | Piloto", companyIds: ["c-trigo"], matchedBy: "nome" },
    })
    expect(matchChat(group("g-x@g.us", "Acmeville churrasco"), idx).status).toBe("ignored")
  })
  it("participante com telefone confirmado: candidato pela empresa dele", () => {
    const r = matchChat(group("g-y@g.us", "Projeto X", ["552187654321"]), idx)
    expect(r.status === "candidate" && r.candidate).toMatchObject({ companyIds: ["c-acme"], matchedBy: "participante" })
  })
  it("nada: ignorado", () => {
    expect(matchChat(group("g-z@g.us", "Futebol de quinta", ["5521977778888"]), idx).status).toBe("ignored")
  })
})
