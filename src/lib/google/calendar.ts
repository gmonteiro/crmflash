import { isInternalEmail, normalizeEmail } from "@/lib/identity/normalize"
import type { CalendarAttendee, NewCalendarEvent } from "@/lib/hub/store"

// Cliente mínimo da Calendar API v3, por fetch. Sem googleapis: são duas
// chamadas (token e events.list) e o pacote pesa dezenas de MB no bundle.

export interface GoogleAttendee {
  email?: string
  displayName?: string
  responseStatus?: string
  organizer?: boolean
  self?: boolean
  resource?: boolean
}

export interface GoogleEvent {
  id: string
  status?: string
  etag?: string
  iCalUID?: string
  recurringEventId?: string
  summary?: string
  created?: string
  updated?: string
  htmlLink?: string
  hangoutLink?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  organizer?: { email?: string; self?: boolean }
  attendees?: GoogleAttendee[]
}

export interface ListResult {
  events: GoogleEvent[]
  nextSyncToken: string | null
}

export class SyncTokenExpiredError extends Error {}

export async function googleAccessToken(env = process.env): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID ?? "",
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      refresh_token: env.GOOGLE_REFRESH_TOKEN ?? "",
      grant_type: "refresh_token",
    }),
  })
  if (!res.ok) throw new Error(`Google token ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { access_token: string }
  return json.access_token
}

/**
 * Sync incremental. Sem syncToken: carga cheia desde `fullSyncFrom`. Com
 * syncToken: só o que mudou (inclusive cancelados). Token expirado (410)
 * vira SyncTokenExpiredError, e quem chama refaz a carga cheia.
 */
export async function listCalendarEvents(opts: {
  accessToken: string
  calendarId: string
  syncToken: string | null
  fullSyncFrom: string
}): Promise<ListResult> {
  const events: GoogleEvent[] = []
  let pageToken: string | undefined
  let nextSyncToken: string | null = null

  do {
    const params = new URLSearchParams({ singleEvents: "true", showDeleted: "true", maxResults: "250" })
    if (opts.syncToken) params.set("syncToken", opts.syncToken)
    else params.set("timeMin", opts.fullSyncFrom)
    if (pageToken) params.set("pageToken", pageToken)

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(opts.calendarId)}/events?${params}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${opts.accessToken}` } })
    if (res.status === 410) throw new SyncTokenExpiredError("syncToken expirado")
    if (!res.ok) throw new Error(`Calendar ${res.status}: ${await res.text()}`)

    const json = (await res.json()) as { items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string }
    events.push(...(json.items ?? []))
    pageToken = json.nextPageToken
    nextSyncToken = json.nextSyncToken ?? nextSyncToken
  } while (pageToken)

  return { events, nextSyncToken }
}

function when(t?: { dateTime?: string; date?: string }): string | null {
  if (!t) return null
  if (t.dateTime) return new Date(t.dateTime).toISOString()
  if (t.date) return new Date(`${t.date}T00:00:00Z`).toISOString()
  return null
}

export function toCalendarRow(ev: GoogleEvent, internal: Set<string>): NewCalendarEvent {
  const attendees: CalendarAttendee[] = (ev.attendees ?? [])
    .filter((a) => !a.resource)
    .map((a) => ({
      email: normalizeEmail(a.email),
      name: a.displayName ?? null,
      responseStatus: a.responseStatus ?? null,
      organizer: !!a.organizer,
      self: !!a.self,
      internal: !!a.self || isInternalEmail(a.email, internal),
    }))

  return {
    googleEventId: ev.id,
    icalUid: ev.iCalUID ?? null,
    recurringEventId: ev.recurringEventId ?? null,
    summary: ev.summary ?? null,
    startAt: when(ev.start),
    endAt: when(ev.end),
    status: ev.status ?? "confirmed",
    organizerEmail: normalizeEmail(ev.organizer?.email),
    attendees,
    htmlLink: ev.htmlLink ?? null,
    meetLink: ev.hangoutLink ?? null,
    etag: ev.etag ?? null,
    googleCreatedAt: ev.created ?? null,
  }
}

/** Só convites com alguém de fora interessam ao CRM (e só eles são espelhados). */
export function hasExternalAttendee(row: NewCalendarEvent): boolean {
  return row.attendees.some((a) => !a.internal && !!a.email)
}
