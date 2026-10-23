import { describe, it, expect, beforeEach } from "vitest"
import { MemoryHubStore } from "./memory-store"
import { ingestGoogleEvent, relinkPending } from "./calendar-ingest"
import type { GoogleEvent } from "@/lib/google/calendar"

const INTERNAL = new Set(["lumeis.ai"])
const ACME = "co-acme"

function invite(over: Partial<GoogleEvent> = {}): GoogleEvent {
  return {
    id: "evt-1",
    etag: '"1"',
    status: "confirmed",
    summary: "Diagnóstico Acme",
    created: "2026-10-01T12:00:00.000Z",
    updated: "2026-10-01T12:00:00.000Z",
    start: { dateTime: "2026-10-10T13:00:00-03:00" },
    end: { dateTime: "2026-10-10T14:00:00-03:00" },
    organizer: { email: "gabriel@lumeis.ai", self: true },
    attendees: [
      { email: "gabriel@lumeis.ai", self: true, organizer: true, responseStatus: "accepted" },
      { email: "joao@acme.com.br", displayName: "João Silva", responseStatus: "accepted" },
    ],
    ...over,
  }
}

let store: MemoryHubStore
beforeEach(() => {
  store = new MemoryHubStore()
  store.addCompany({ id: ACME, name: "Acme" })
  store.domains.set("acme.com.br", { domain: "acme.com.br", companyId: ACME, ignored: false })
})

const kinds = () => [...store.events.values()].map((e) => e.kind).sort()

describe("ingestão do Calendar", () => {
  it("convite com cliente → meeting.scheduled na conta, pessoa criada e ligada", async () => {
    await ingestGoogleEvent(store, invite(), INTERNAL)
    expect(kinds()).toEqual(["meeting.scheduled"])
    const ev = [...store.events.values()][0]
    expect(ev).toMatchObject({ companyId: ACME, source: "calendar", sourceId: "evt-1", type: "meeting" })
    expect(store.people.size).toBe(1)
    expect(store.participants.size).toBe(1)
    expect(await store.calendarCompanies([...store.calendar.values()][0].id)).toEqual([ACME])
  })

  it("convite meu não reseta o contador; convite do cliente reseta, na data do convite", async () => {
    await ingestGoogleEvent(store, invite(), INTERNAL)
    expect(store.companies.get(ACME)!.lastClientEventAt).toBeUndefined()
    expect([...store.events.values()][0]).toMatchObject({ clientEngaged: false, engagementRule: "cal.lumeis_invite" })

    await ingestGoogleEvent(
      store,
      invite({
        id: "evt-2",
        organizer: { email: "joao@acme.com.br" },
        attendees: [
          { email: "joao@acme.com.br", displayName: "João Silva", organizer: true },
          { email: "gabriel@lumeis.ai", self: true },
        ],
      }),
      INTERNAL
    )
    expect(store.companies.get(ACME)!.lastClientEventAt).toBe("2026-10-01T12:00:00.000Z")
  })

  it("IDEMPOTÊNCIA: o mesmo convite três vezes, mesmas contagens", async () => {
    for (let i = 0; i < 3; i++) await ingestGoogleEvent(store, invite(), INTERNAL)
    expect(store.events.size).toBe(1)
    expect(store.people.size).toBe(1)
    expect(store.calendar.size).toBe(1)
    expect(store.participants.size).toBe(1)
  })

  it("etag novo atualiza a linha, não duplica", async () => {
    await ingestGoogleEvent(store, invite(), INTERNAL)
    await ingestGoogleEvent(store, invite({ etag: '"2"', summary: "Diagnóstico Acme (pauta)" }), INTERNAL)
    expect(store.events.size).toBe(1)
    expect([...store.events.values()][0].title).toBe("Convite: Diagnóstico Acme (pauta)")
  })

  it("remarcação vira fato próprio, uma vez por horário", async () => {
    await ingestGoogleEvent(store, invite(), INTERNAL)
    const moved = invite({ etag: '"2"', start: { dateTime: "2026-10-12T13:00:00-03:00" }, end: { dateTime: "2026-10-12T14:00:00-03:00" } })
    await ingestGoogleEvent(store, moved, INTERNAL)
    await ingestGoogleEvent(store, moved, INTERNAL)
    expect(kinds()).toEqual(["meeting.rescheduled", "meeting.scheduled"])
  })

  it("cancelamento sem participantes (sync incremental) usa o espelho", async () => {
    await ingestGoogleEvent(store, invite(), INTERNAL)
    await ingestGoogleEvent(store, { id: "evt-1", status: "cancelled", etag: '"3"' }, INTERNAL)
    expect(kinds()).toEqual(["meeting.cancelled", "meeting.scheduled"])
    expect([...store.events.values()].every((e) => !e.clientEngaged)).toBe(true)
  })

  it("reunião só interna não é espelhada", async () => {
    const stats = await ingestGoogleEvent(
      store,
      invite({ attendees: [{ email: "gabriel@lumeis.ai", self: true }, { email: "socio@lumeis.ai" }] }),
      INTERNAL
    )
    expect(stats.skippedInternal).toBe(1)
    expect(store.calendar.size).toBe(0)
  })

  it("domínio desconhecido fica pendente e é religado depois que a fila é resolvida", async () => {
    const gev = invite({ id: "evt-9", attendees: [{ email: "carla@beta.com" }, { email: "gabriel@lumeis.ai", self: true }] })
    const first = await ingestGoogleEvent(store, gev, INTERNAL)
    expect(first.pending).toBe(1)
    expect(store.events.size).toBe(0)
    expect(store.reviews.size).toBe(1)

    // Você resolve: beta.com é a empresa Beta.
    store.addCompany({ id: "co-beta", name: "Beta" })
    await store.addDomain({ domain: "beta.com", companyId: "co-beta", source: "review" })

    const second = await relinkPending(store, INTERNAL, "2026-10-01T00:00:00Z", "2026-10-31T00:00:00Z")
    expect(second.linked).toBe(1)
    expect([...store.events.values()][0]).toMatchObject({ companyId: "co-beta", kind: "meeting.scheduled" })
  })

  it("convite com duas empresas vira um evento em cada timeline", async () => {
    store.addCompany({ id: "co-beta", name: "Beta" })
    store.domains.set("beta.com", { domain: "beta.com", companyId: "co-beta", ignored: false })
    await ingestGoogleEvent(
      store,
      invite({ attendees: [{ email: "joao@acme.com.br" }, { email: "carla@beta.com" }, { email: "gabriel@lumeis.ai", self: true }] }),
      INTERNAL
    )
    expect([...store.events.values()].map((e) => e.companyId).sort()).toEqual([ACME, "co-beta"])
  })
})
