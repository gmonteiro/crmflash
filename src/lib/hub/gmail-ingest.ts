import { recordEvent } from "@/lib/events/record"
import type { EventKind, ParticipantRef } from "@/lib/events/types"
import type { GmailMessage, ParsedMessage } from "@/lib/google/gmail"
import { HistoryExpiredError, parseMessage } from "@/lib/google/gmail"
import { emailDomain, isFreeMailDomain, isInternalEmail } from "@/lib/identity/normalize"
import { resolveObservation } from "@/lib/identity/resolve"
import type { HubStore } from "./store"

// E-mail do Gmail → evento na conta.
//
//   - lista, newsletter, notificação (List-Id, List-Unsubscribe, Precedence,
//     no-reply, abas Promoções/Social/Atualizações): ignorado, não é conversa;
//   - de alguém da Lumeis → email.sent (não reseta o contador); a conta vem
//     dos destinatários de fora;
//   - de fora → email.received (reseta, na data do e-mail) ou
//     email.auto_reply (resposta automática, não reseta);
//   - identidade pela escada; só e-mail RECEBIDO de domínio de empresa
//     desconhecido abre caso na fila. Enviado e gmail/hotmail só ligam pelo
//     que já é conhecido.
//
// O CRM guarda cabeçalhos e o snippet (≤ 500 caracteres); o corpo fica no Gmail.

export interface GmailIngestStats {
  seen: number
  skippedBulk: number
  skippedInternal: number
  unresolved: number
  linked: number
  events: number
}

export function emptyGmailStats(): GmailIngestStats {
  return { seen: 0, skippedBulk: 0, skippedInternal: 0, unresolved: 0, linked: 0, events: 0 }
}

export function gmailThreadUrl(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${threadId}`
}

export async function ingestGmailMessage(
  store: HubStore,
  m: ParsedMessage,
  internal: Set<string>,
  stats: GmailIngestStats = emptyGmailStats()
): Promise<GmailIngestStats> {
  stats.seen++
  if (m.bulk || !m.from) {
    stats.skippedBulk++
    return stats
  }

  const fromLumeis = isInternalEmail(m.from.email, internal)
  const kind: EventKind = fromLumeis ? "email.sent" : m.autoReply ? "email.auto_reply" : "email.received"
  const toSet = new Set(m.to.map((a) => a.email))
  const externals = fromLumeis
    ? [...m.to, ...m.cc].filter((a) => !isInternalEmail(a.email, internal))
    : [m.from]
  if (externals.length === 0) {
    stats.skippedInternal++
    return stats
  }

  const byCompany = new Map<string, ParticipantRef[]>()
  for (const a of externals) {
    const domain = emailDomain(a.email)
    const r = await resolveObservation(
      store,
      {
        email: a.email,
        name: a.name,
        source: "gmail",
        sourceRef: m.id,
        openReview: kind === "email.received" && !!domain && !isFreeMailDomain(domain),
      },
      internal
    )
    if (r.status !== "linked" || !r.companyId) continue
    const role: ParticipantRef["role"] = fromLumeis ? (toSet.has(a.email) ? "to" : "cc") : "from"
    const refs = byCompany.get(r.companyId) ?? []
    refs.push({ personId: r.personId, role })
    byCompany.set(r.companyId, refs)
  }

  if (byCompany.size === 0) {
    stats.unresolved++
    return stats
  }
  stats.linked++

  const url = gmailThreadUrl(m.threadId)
  const subject = m.subject.trim() || "(sem assunto)"
  for (const [companyId, participants] of byCompany) {
    await recordEvent(store, {
      source: "gmail",
      sourceId: m.id,
      kind,
      companyId,
      occurredAt: m.sentAt,
      direction: fromLumeis ? "outbound" : "inbound",
      title: fromLumeis ? `E-mail enviado: ${subject}` : `E-mail: ${subject}`,
      description: m.snippet || null,
      facts: { autoReply: m.autoReply, fromClient: !fromLumeis },
      evidence: [
        {
          kind: "email",
          ref: m.id,
          url,
          quote: m.snippet ? m.snippet.slice(0, 280) : undefined,
          locator: `${fromLumeis ? "para" : "de"} ${(fromLumeis ? externals : [m.from]).map((a) => a.email).join(", ")}`,
        },
      ],
      participants,
      conversationKey: `gmail:${m.threadId}`,
    })
    stats.events++
  }
  return stats
}

// --- sync -----------------------------------------------------------------

export interface GmailSource {
  profileHistoryId(): Promise<string>
  listIds(q: string): Promise<string[]>
  history(startHistoryId: string): Promise<{ ids: string[]; historyId: string }>
  get(id: string): Promise<GmailMessage | null>
}

/** O cursor guarda o historyId e, numa carga cheia que não coube, o que falta. */
interface GmailCursor {
  h: string
  q?: string[]
}

export const GMAIL_BACKFILL_DAYS = 30
export const GMAIL_SYNC_BUDGET_MS = 240_000

export async function syncGmail(
  store: HubStore,
  source: GmailSource,
  internal: Set<string>,
  opts: { budgetMs?: number; now?: () => number; account?: string } = {}
): Promise<GmailIngestStats & { fullSync: boolean; complete: boolean; pending: number }> {
  const now = opts.now ?? Date.now
  const started = now()
  const budget = opts.budgetMs ?? GMAIL_SYNC_BUDGET_MS
  const key = opts.account ?? "default"
  const raw = await store.getCursor("gmail", key)
  let cursor: GmailCursor | null = raw ? (JSON.parse(raw) as GmailCursor) : null
  let fullSync = false

  let queue: string[] = cursor?.q ?? []
  let historyId = cursor?.h ?? null
  if (historyId && queue.length === 0) {
    try {
      const inc = await source.history(historyId)
      queue = inc.ids
      historyId = inc.historyId
    } catch (e) {
      if (!(e instanceof HistoryExpiredError)) throw e
      historyId = null
    }
  }
  if (!historyId) {
    // O historyId vem ANTES da lista: o que chegar durante a carga cai no próximo incremental.
    historyId = await source.profileHistoryId()
    queue = await source.listIds(`newer_than:${GMAIL_BACKFILL_DAYS}d -in:chats`)
    fullSync = true
  }

  const stats = emptyGmailStats()
  let done = 0
  for (const id of queue) {
    if (now() - started > budget) break
    const msg = await source.get(id)
    if (msg) await ingestGmailMessage(store, parseMessage(msg), internal, stats)
    done++
  }
  const rest = queue.slice(done)
  cursor = rest.length ? { h: historyId, q: rest } : { h: historyId }
  await store.setCursor("gmail", JSON.stringify(cursor), key)
  return { ...stats, fullSync, complete: rest.length === 0, pending: rest.length }
}
