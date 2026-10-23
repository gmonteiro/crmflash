import { describe, it, expect, beforeEach } from "vitest"
import { MemoryHubStore } from "@/lib/hub/memory-store"
import { matchSpeakers, resolveObservation, type MeetingParticipant } from "./resolve"

const INTERNAL = new Set(["lumeis.ai"])
const ACME = "co-acme"

let store: MemoryHubStore

beforeEach(() => {
  store = new MemoryHubStore()
  store.addCompany({ id: ACME, name: "Acme Ltda" })
  store.domains.set("acme.com.br", { domain: "acme.com.br", companyId: ACME, ignored: false })
})

function obs(email: string | null, name: string | null = null, ctx: string[] = []) {
  return { email, name, source: "calendar", sourceRef: "evt-1", contextCompanyIds: ctx }
}

describe("degrau 0 — internos e sem e-mail", () => {
  it("e-mail da Lumeis não vira pessoa", async () => {
    expect(await resolveObservation(store, obs("gabriel@lumeis.ai"), INTERNAL)).toEqual({ status: "internal" })
  })
  it("sem e-mail não resolve (só nome nunca funde)", async () => {
    const r = await resolveObservation(store, obs(null, "João Silva"), INTERNAL)
    expect(r.status).toBe("unresolvable")
    expect(store.people.size).toBe(0)
    expect(store.reviews.size).toBe(0)
  })
})

describe("degrau 1 — identidade conhecida", () => {
  it("liga direto, com qualquer grafia do e-mail", async () => {
    const p = store.addPersonRow({ firstName: "João", lastName: "Silva", companyId: ACME })
    await store.addIdentity({ personId: p.id, kind: "email", valueNorm: "joao@acme.com.br", source: "t", confidence: "strong" })
    const r = await resolveObservation(store, obs("  JOAO@Acme.com.br"), INTERNAL)
    expect(r).toMatchObject({ status: "linked", personId: p.id, companyId: ACME, via: "identity" })
  })
  it("identidade ignorada (fornecedor, recrutador) não gera nada", async () => {
    await store.addIdentity({ personId: null, ignored: true, kind: "email", valueNorm: "spam@acme.com.br", source: "t", confidence: "confirmed" })
    expect(await resolveObservation(store, obs("spam@acme.com.br"), INTERNAL)).toEqual({ status: "ignored" })
  })
})

describe("degrau 2 — domínio conhecido", () => {
  it("uma pessoa compatível na empresa → liga e aprende o e-mail", async () => {
    const p = store.addPersonRow({ firstName: "João", lastName: "Silva", companyId: ACME })
    const r = await resolveObservation(store, obs("jsilva@acme.com.br", "João S."), INTERNAL)
    expect(r).toMatchObject({ status: "linked", personId: p.id, via: "domain_name_match" })
    // A próxima observação já cai no degrau 1.
    const again = await resolveObservation(store, obs("jsilva@acme.com.br"), INTERNAL)
    expect(again).toMatchObject({ status: "linked", via: "identity" })
  })

  it("nenhuma pessoa compatível → cria, ligada à empresa", async () => {
    const r = await resolveObservation(store, obs("maria@acme.com.br", "Maria Souza"), INTERNAL)
    expect(r).toMatchObject({ status: "linked", companyId: ACME, via: "domain_new_person", created: true })
    const created = [...store.people.values()][0]
    expect(created).toMatchObject({ firstName: "Maria", lastName: "Souza", companyId: ACME })
  })

  it("sem nome no convite, deriva do e-mail", async () => {
    await resolveObservation(store, obs("ana.lima@acme.com.br"), INTERNAL)
    expect([...store.people.values()][0]).toMatchObject({ firstName: "Ana", lastName: "Lima" })
  })

  it("homônimos na mesma empresa → fila, nada criado nem ligado", async () => {
    store.addPersonRow({ firstName: "João", lastName: "Silva", companyId: ACME })
    store.addPersonRow({ firstName: "João", lastName: "Santos", companyId: ACME })
    const r = await resolveObservation(store, obs("joao.s@acme.com.br", "João S."), INTERNAL)
    expect(r).toMatchObject({ status: "review", reason: "homonimos_na_empresa" })
    expect(store.identities.size).toBe(0)
    expect([...store.reviews.values()][0].candidates).toHaveLength(2)
  })

  it("rodar duas vezes não abre duas revisões", async () => {
    store.addPersonRow({ firstName: "João", lastName: "Silva", companyId: ACME })
    store.addPersonRow({ firstName: "João", lastName: "Santos", companyId: ACME })
    await resolveObservation(store, obs("joao.s@acme.com.br", "João S."), INTERNAL)
    await resolveObservation(store, obs("joao.s@acme.com.br", "João S."), INTERNAL)
    expect(store.reviews.size).toBe(1)
  })

  it("rodar duas vezes não cria duas pessoas", async () => {
    await resolveObservation(store, obs("maria@acme.com.br", "Maria Souza"), INTERNAL)
    await resolveObservation(store, obs("maria@acme.com.br", "Maria Souza"), INTERNAL)
    expect(store.people.size).toBe(1)
  })
})

describe("degrau 3 — domínio desconhecido", () => {
  it("nunca grava o domínio sozinho; sugere a empresa pelo nome", async () => {
    store.addCompany({ id: "co-beta", name: "Beta S.A." })
    const r = await resolveObservation(store, obs("ceo@beta.com", "Carla"), INTERNAL)
    expect(r).toMatchObject({ status: "review", reason: "dominio_desconhecido" })
    expect(store.domains.has("beta.com")).toBe(false)
    expect([...store.reviews.values()][0].candidates[0]).toMatchObject({ companyId: "co-beta" })
  })
})

describe("degrau 4 — e-mail genérico", () => {
  it("gmail desconhecido → fila, mesmo com nome idêntico a alguém", async () => {
    store.addPersonRow({ firstName: "João", lastName: "Silva", companyId: ACME })
    const r = await resolveObservation(store, obs("joaosilva@gmail.com", "João Silva", [ACME]), INTERNAL)
    expect(r).toMatchObject({ status: "review", reason: "email_generico_desconhecido" })
    expect([...store.reviews.values()][0].candidates).toHaveLength(1)
    expect(store.identities.size).toBe(0)
  })
  it("gmail nunca liga empresa por domínio", async () => {
    store.domains.set("gmail.com", { domain: "gmail.com", companyId: ACME, ignored: false })
    const r = await resolveObservation(store, obs("qualquer@gmail.com", "Fulano"), INTERNAL)
    expect(r.status).toBe("review")
  })
})

describe("degrau 5 — falantes em mundo fechado", () => {
  const participants: MeetingParticipant[] = [
    { personId: "p-joao", name: "João Silva", email: "joao@acme.com.br", internal: false },
    { personId: "p-maria", name: "Maria Souza", email: "maria@acme.com.br", internal: false },
    { personId: null, name: "Gabriel Monteiro", email: "gabriel@lumeis.ai", internal: true },
  ]

  it("primeiro nome casa com o único participante compatível", () => {
    const [m] = matchSpeakers([{ id: "s1", name: "João", email: null }], participants)
    expect(m).toEqual({ speakerId: "s1", status: "person", personId: "p-joao", via: "name" })
  })
  it("e-mail no nome do falante (formato do TranscriptionApp) vence o nome", () => {
    const [m] = matchSpeakers([{ id: "s1", name: "Maria", email: "maria@acme.com.br" }], participants)
    expect(m).toMatchObject({ status: "person", personId: "p-maria", via: "email" })
  })
  it("o falante da Lumeis é interno", () => {
    const [m] = matchSpeakers([{ id: "s1", name: "Gabriel", email: null }], participants)
    expect(m).toEqual({ speakerId: "s1", status: "internal" })
  })
  it("dois Joões na reunião → ambíguo", () => {
    const two = [...participants, { personId: "p-joao2", name: "João Pedro", email: "jp@acme.com.br", internal: false }]
    const [m] = matchSpeakers([{ id: "s1", name: "João", email: null }], two)
    expect(m).toMatchObject({ status: "ambiguous", candidates: ["p-joao", "p-joao2"] })
  })
  it("'Pessoa 2' e nomes fora da reunião ficam desconhecidos", () => {
    const ms = matchSpeakers(
      [
        { id: "s1", name: "Pessoa 2", email: null },
        { id: "s2", name: "Ricardo", email: null },
      ],
      participants
    )
    expect(ms.map((m) => m.status)).toEqual(["unknown", "unknown"])
  })
})
