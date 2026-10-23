import { googleAccessToken, listCalendarEvents, SyncTokenExpiredError } from "@/lib/google/calendar"
import { internalDomains } from "@/lib/identity/normalize"
import { TranscriptionAppClient } from "@/lib/transcription/client"
import { emptyStats, ingestGoogleEvent, relinkPending, type CalendarIngestStats } from "./calendar-ingest"
import { ClaudeExtractor } from "./extraction"
import type { HubStore } from "./store"
import { syncTranscripts, type SyncResult } from "./transcript-ingest"

// As duas rodadas do MVP, chamadas pelo cron (/api/cron/*) e pela tool
// sync_now do MCP. Cada uma é idempotente: rodar duas vezes seguidas não muda
// nada na segunda.

const DAY = 24 * 60 * 60 * 1000
/** Carga cheia (primeira vez, ou syncToken expirado): os últimos 30 dias. */
const FULL_SYNC_DAYS = 30
/** Folga dentro dos 300 s da função. */
const CALENDAR_SYNC_BUDGET_MS = 240_000

export async function runCalendarSync(
  store: HubStore
): Promise<CalendarIngestStats & { fullSync: boolean; complete: boolean }> {
  const started = Date.now()
  const internal = internalDomains()
  const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary"
  const accessToken = await googleAccessToken()
  const fullSyncFrom = new Date(Date.now() - FULL_SYNC_DAYS * DAY).toISOString()

  let syncToken = await store.getCursor("calendar", calendarId)
  let fullSync = !syncToken
  let listed
  try {
    listed = await listCalendarEvents({ accessToken, calendarId, syncToken, fullSyncFrom })
  } catch (e) {
    if (!(e instanceof SyncTokenExpiredError)) throw e
    // O Google invalida o token de tempos em tempos: refaz a carga cheia.
    syncToken = null
    fullSync = true
    listed = await listCalendarEvents({ accessToken, calendarId, syncToken, fullSyncFrom })
  }

  const stats = emptyStats()
  let complete = true
  for (const ev of listed.events) {
    // Estourou: para sem gravar o syncToken. A próxima rodada relista e refaz;
    // as escritas são idempotentes, então o que já entrou não duplica.
    if (Date.now() - started > CALENDAR_SYNC_BUDGET_MS) {
      complete = false
      break
    }
    await ingestGoogleEvent(store, ev, internal, stats)
  }
  if (!complete) return { ...stats, fullSync, complete }

  // Convites que estavam esperando você resolver a fila.
  await relinkPending(store, internal, fullSyncFrom, new Date(Date.now() + FULL_SYNC_DAYS * DAY).toISOString(), stats)

  if (listed.nextSyncToken) await store.setCursor("calendar", listed.nextSyncToken, calendarId)
  return { ...stats, fullSync, complete }
}

export async function runTranscriptSync(store: HubStore): Promise<SyncResult> {
  return syncTranscripts(store, new TranscriptionAppClient(), new ClaudeExtractor(), internalDomains())
}
