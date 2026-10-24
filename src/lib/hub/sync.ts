import { googleAccessToken, listCalendarEvents, SyncTokenExpiredError } from "@/lib/google/calendar"
import { getMessageMetadata, gmailProfileHistoryId, historyMessageIds, listMessageIds, sendGmail } from "@/lib/google/gmail"
import { internalDomains } from "@/lib/identity/normalize"
import { TranscriptionAppClient } from "@/lib/transcription/client"
import { emptyStats, ingestGoogleEvent, relinkPending, type CalendarIngestStats } from "./calendar-ingest"
import { ClaudeReviewer, composeDigest, runDailyReview, type DailyReviewStore } from "./daily-review"
import { ClaudeExtractor } from "./extraction"
import { syncGmail, type GmailSource } from "./gmail-ingest"
import { openItems } from "./open-items"
import type { HubStore, OpenItemsStore } from "./store"
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

export async function runTranscriptSync(store: HubStore, budgetMs?: number): Promise<SyncResult> {
  return syncTranscripts(store, new TranscriptionAppClient(), new ClaudeExtractor(), internalDomains(), { budgetMs })
}

/** A caixa da conta comercial (o mesmo refresh token do Calendar, com gmail.readonly). */
export async function runGmailSync(store: HubStore, budgetMs?: number) {
  const token = await googleAccessToken()
  const source: GmailSource = {
    profileHistoryId: () => gmailProfileHistoryId(token),
    listIds: (q) => listMessageIds(token, q),
    history: (h) => historyMessageIds(token, h),
    get: (id) => getMessageMetadata(token, id),
  }
  return syncGmail(store, source, internalDomains(), { budgetMs })
}

/**
 * Revisão diária + resumo por e-mail. O resumo sai uma vez por dia (o cursor
 * daily_digest guarda o dia enviado) e só se houver risco, sugestão, avanço ou
 * caso na fila. Rodar com companyId revisa só aquela conta e não manda e-mail.
 */
export async function runDailyReviewAndDigest(store: HubStore & DailyReviewStore & OpenItemsStore, opts: { companyId?: string } = {}) {
  const review = await runDailyReview(store, new ClaudeReviewer(), { companyId: opts.companyId })
  if (opts.companyId) return { ...review, digest: null }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://crmflash.vercel.app").replace(/\/$/, "")
  // Tudo que espera você, da mesma função da página /pendencias.
  const items = await openItems(store, { now: Date.now() })
  const digest = composeDigest(
    review.today,
    await store.reviewsOn(review.today),
    items.decisions.length,
    appUrl,
    items.system.map((s) => s.message),
    {
      waitingYou: items.waitingYou.filter((c) => c.ageHours > 24),
      waitingClient: items.waitingClient.filter((c) => c.ageHours > 7 * 24),
    }
  )
  const to = process.env.DIGEST_TO_EMAIL
  let sent: string | null = null
  if (digest && to && review.complete && (await store.getCursor("daily_digest")) !== review.today) {
    sent = await sendGmail(await googleAccessToken(), { to, subject: digest.subject, html: digest.html })
    await store.setCursor("daily_digest", review.today)
  }
  return { ...review, digest: digest ? { subject: digest.subject, counts: digest.counts, sent: !!sent, to: to ?? null } : null }
}
