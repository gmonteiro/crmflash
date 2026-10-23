import { recordEvent } from "@/lib/events/record"
import type { ParticipantRef } from "@/lib/events/types"
import { resolveObservation } from "@/lib/identity/resolve"
import { hasExternalAttendee, toCalendarRow, type GoogleEvent } from "@/lib/google/calendar"
import type { CalendarEventRow, HubStore, NewCalendarEvent } from "./store"

// Convite do Calendar → evento na conta certa.
//
// Para cada convite com alguém de fora: espelha o mínimo (calendar_events),
// resolve cada participante externo pela escada de identidade, liga o convite
// à(s) empresa(s) e grava meeting.scheduled / rescheduled / cancelled.
// Participante que a escada não resolve vira revisão na fila — e o convite é
// religado na próxima rodada, quando você já tiver resolvido (relinkPending).

export interface CalendarIngestStats {
  seen: number
  skippedInternal: number
  linked: number
  pending: number
  events: number
}

export function emptyStats(): CalendarIngestStats {
  return { seen: 0, skippedInternal: 0, linked: 0, pending: 0, events: 0 }
}

export async function ingestGoogleEvent(
  store: HubStore,
  gev: GoogleEvent,
  internal: Set<string>,
  stats: CalendarIngestStats = emptyStats()
): Promise<CalendarIngestStats> {
  stats.seen++
  const previous = await store.getCalendarEventByGoogleId(gev.id)
  let row = toCalendarRow(gev, internal)

  // Cancelamento no sync incremental chega sem participantes. Sem o espelho
  // anterior, não daria para saber de qual conta era.
  if (row.status === "cancelled" && previous && row.attendees.length === 0) {
    row = { ...previous, status: "cancelled", etag: row.etag ?? previous.etag }
  }

  if (!hasExternalAttendee(row)) {
    stats.skippedInternal++
    return stats
  }

  const saved = await store.upsertCalendarEvent(row)
  await linkAndRecord(store, saved, row, previous, gev, internal, stats)
  return stats
}

async function linkAndRecord(
  store: HubStore,
  saved: CalendarEventRow,
  row: NewCalendarEvent,
  previous: CalendarEventRow | null,
  gev: Pick<GoogleEvent, "created" | "updated">,
  internal: Set<string>,
  stats: CalendarIngestStats
) {
  const companies = new Set(await store.calendarCompanies(saved.id))
  const byCompany = new Map<string, ParticipantRef[]>()

  for (const a of row.attendees) {
    if (a.internal || !a.email) continue
    const r = await resolveObservation(
      store,
      {
        email: a.email,
        name: a.name,
        source: "calendar",
        sourceRef: saved.googleEventId,
        contextCompanyIds: [...companies],
      },
      internal
    )
    if (r.status === "linked" && r.companyId) {
      if (!companies.has(r.companyId)) {
        await store.linkCalendarCompany(saved.id, r.companyId, `attendee:${r.via}`)
        companies.add(r.companyId)
      }
      const refs = byCompany.get(r.companyId) ?? []
      refs.push({ personId: r.personId, role: a.organizer ? "organizer" : "attendee" })
      byCompany.set(r.companyId, refs)
    }
  }

  if (companies.size === 0) {
    stats.pending++
    return
  }
  stats.linked++

  const organizerIsClient =
    !!row.organizerEmail && row.attendees.some((a) => a.email === row.organizerEmail && !a.internal)
  const evidence = [{ kind: "calendar" as const, ref: saved.googleEventId, url: saved.htmlLink ?? undefined }]
  const title = row.summary ?? "Reunião"

  for (const companyId of companies) {
    const participants = byCompany.get(companyId) ?? []
    const base = {
      source: "calendar" as const,
      companyId,
      direction: (organizerIsClient ? "inbound" : "outbound") as "inbound" | "outbound",
      facts: { organizerIsClient },
      evidence,
      participants,
      sourceVersion: row.etag,
    }

    // Sempre: o convite existe. Idempotente pela chave; o etag só atualiza a linha.
    await recordEvent(store, {
      ...base,
      sourceId: saved.googleEventId,
      kind: "meeting.scheduled",
      // Sem `created` (religação), vale quando ficamos sabendo — nunca o
      // horário da reunião, que pode estar no futuro.
      occurredAt: gev.created ?? new Date().toISOString(),
      title: `Convite: ${title}`,
      description: row.startAt ? `Marcada para ${row.startAt}` : null,
    })
    stats.events++

    if (previous && previous.startAt && row.startAt && previous.startAt !== row.startAt && row.status !== "cancelled") {
      // Cada remarcação é um fato próprio: o id carrega o novo horário.
      await recordEvent(store, {
        ...base,
        sourceId: `${saved.googleEventId}@${row.startAt}`,
        kind: "meeting.rescheduled",
        occurredAt: gev.updated ?? new Date().toISOString(),
        title: `Remarcada: ${title}`,
        description: `De ${previous.startAt} para ${row.startAt}`,
      })
      stats.events++
    }

    if (row.status === "cancelled") {
      await recordEvent(store, {
        ...base,
        sourceId: saved.googleEventId,
        kind: "meeting.cancelled",
        occurredAt: gev.updated ?? new Date().toISOString(),
        title: `Cancelada: ${title}`,
      })
      stats.events++
    }
  }
}

/**
 * Convites que ficaram sem empresa (participante na fila). Depois que você
 * resolve a revisão, a identidade existe e esta passada liga o convite.
 */
export async function relinkPending(
  store: HubStore,
  internal: Set<string>,
  fromISO: string,
  toISO: string,
  stats: CalendarIngestStats = emptyStats()
): Promise<CalendarIngestStats> {
  for (const ev of await store.calendarEventsOverlapping(fromISO, toISO)) {
    if ((await store.calendarCompanies(ev.id)).length > 0) continue
    if (!hasExternalAttendee(ev)) continue
    await linkAndRecord(store, ev, ev, null, {}, internal, stats)
  }
  return stats
}

/** Regrava os eventos de um convite já espelhado (ex.: depois de ligar à mão). */
export async function reingestCalendarEvent(
  store: HubStore,
  ev: CalendarEventRow,
  internal: Set<string>
): Promise<CalendarIngestStats> {
  const stats = emptyStats()
  await linkAndRecord(store, ev, ev, null, {}, internal, stats)
  return stats
}
