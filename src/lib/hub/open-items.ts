import type { EventKind } from "@/lib/events/types"
import { CRON_NAMES } from "./crons"
import { heartbeatAlert } from "./daily-review"
import type { ConversationEventRow, OpenItemsStore, ReviewCandidate } from "./store"

// TUDO QUE ESPERA O GABRIEL. Uma função, quatro listas, lidas pela página
// /pendencias, pela faixa do dashboard, pelo resumo diário e pela tool
// open_items. "Sem retorno" é calculado na hora, sobre os eventos dos últimos
// 30 dias: não há tabela derivada para ficar velha.
//
//   aguardando você     → a última mensagem do CLIENTE na conversa é a mais nova;
//   aguardando o cliente → a última da LUMEIS é a mais nova, há ≥ 3 dias;
//   decisões            → fila de identidade aberta + propostas da IA;
//   sistema             → coletor de WhatsApp ou cron parado.

export const WINDOW_DAYS = 30
export const WAITING_CLIENT_MIN_HOURS = 72
export const CRON_STALE_MS = 26 * 60 * 60 * 1000
const HOUR = 3_600_000

export interface ConversationItem {
  conversationKey: string
  channel: "gmail" | "whatsapp"
  companyId: string
  companyName: string
  title: string
  preview: string | null
  url: string | null
  lastAt: string
  ageHours: number
}

export interface DecisionItem {
  kind: "identity" | "proposal"
  id: string
  companyId: string | null
  companyName: string | null
  title: string
  detail: string
  createdAt: string
  /** identity: dá para resolver na página (não é projeto nem reunião). proposal: não é estágio. */
  decidableHere: boolean
  candidates: ReviewCandidate[]
  field: string | null
}

export interface SystemItem {
  key: string
  message: string
  since: string | null
}

export interface OpenItems {
  generatedAt: string
  waitingYou: ConversationItem[]
  waitingClient: ConversationItem[]
  decisions: DecisionItem[]
  system: SystemItem[]
}

function sideOf(kind: EventKind, clientEngaged: boolean): "client" | "lumeis" | null {
  if (kind === "whatsapp.received") return "client"
  if (kind === "email.received") return clientEngaged ? "client" : null
  if (kind === "email.sent" || kind === "whatsapp.sent") return "lumeis"
  return null
}

function toItem(e: ConversationEventRow, now: number): ConversationItem {
  return {
    conversationKey: e.conversationKey,
    channel: e.conversationKey.startsWith("gmail:") ? "gmail" : "whatsapp",
    companyId: e.companyId,
    companyName: e.companyName,
    title: e.title,
    preview: e.description ? e.description.slice(-200) : null,
    url: e.url,
    lastAt: e.occurredAt,
    ageHours: Math.max(0, Math.floor((now - Date.parse(e.occurredAt)) / HOUR)),
  }
}

const REASON_TITLE: Record<string, (o: Record<string, unknown>) => string> = {
  dominio_desconhecido: (o) => `Domínio novo: ${o.domain}`,
  email_generico_desconhecido: (o) => `E-mail pessoal sem dono: ${o.name ?? o.email}`,
  homonimos_na_empresa: (o) => `Quem é ${o.name ?? o.email}?`,
  projeto_sem_empresa: (o) => `Projeto do TranscriptionApp sem empresa: ${o.project_name ?? o.project_id}`,
  whatsapp_contato: (o) => `Contato do WhatsApp: ${o.name}`,
  grupo_sem_empresa: (o) => `Grupo do WhatsApp: ${o.group_name}`,
}

const FIELD_LABEL: Record<string, string> = {
  pain_hypothesis: "dor",
  champion: "campeão",
  economic_buyer: "decisor",
}

function proposalTitle(companyName: string, field: string, value: unknown): string {
  const v = (value ?? {}) as { target_stage?: string; value?: string; title?: string }
  if (field === "stage_suggestion") return `${companyName}: mover para ${v.target_stage ?? "?"}`
  if (field.startsWith("next_step:")) return `${companyName}: próximo passo — ${v.title ?? "?"}`
  return `${companyName}: ${FIELD_LABEL[field] ?? field} — ${v.value ?? "?"}`
}

export async function openItems(store: OpenItemsStore, opts: { now: number }): Promise<OpenItems> {
  const { now } = opts
  const since = new Date(now - WINDOW_DAYS * 24 * HOUR).toISOString()
  const [events, dismissals, reviews, inferences, cursors] = await Promise.all([
    store.conversationEvents(since),
    store.dismissals(),
    store.openReviewItems(),
    store.proposedInferences(),
    store.systemCursors(),
  ])

  // Última mensagem de cada lado, por conversa.
  const last = new Map<string, { client?: ConversationEventRow; lumeis?: ConversationEventRow }>()
  for (const e of events) {
    const side = sideOf(e.kind, e.clientEngaged)
    if (!side) continue
    const cur = last.get(e.conversationKey) ?? {}
    if (!cur[side] || cur[side]!.occurredAt < e.occurredAt) cur[side] = e
    last.set(e.conversationKey, cur)
  }
  const dismissedThrough = (key: string, side: "client" | "lumeis") =>
    dismissals.find((d) => d.conversationKey === key && d.side === side)?.dismissedThrough ?? null

  const waitingYou: ConversationItem[] = []
  const waitingClient: ConversationItem[] = []
  for (const [key, { client, lumeis }] of last) {
    if (client && (!lumeis || client.occurredAt > lumeis.occurredAt)) {
      const d = dismissedThrough(key, "client")
      if (!d || Date.parse(d) < Date.parse(client.occurredAt)) waitingYou.push(toItem(client, now))
    } else if (lumeis) {
      const d = dismissedThrough(key, "lumeis")
      const item = toItem(lumeis, now)
      if (item.ageHours >= WAITING_CLIENT_MIN_HOURS && (!d || Date.parse(d) < Date.parse(lumeis.occurredAt))) waitingClient.push(item)
    }
  }
  const oldestFirst = (a: ConversationItem, b: ConversationItem) => a.lastAt.localeCompare(b.lastAt)
  waitingYou.sort(oldestFirst)
  waitingClient.sort(oldestFirst)

  const decisions: DecisionItem[] = [
    ...reviews.map((r) => ({
      kind: "identity" as const,
      id: r.id,
      companyId: r.companyId,
      companyName: r.companyName,
      title: (REASON_TITLE[r.reason] ?? ((o: Record<string, unknown>) => String(o.name ?? o.email ?? o.domain ?? r.reason)))(r.observed),
      detail: r.reason.replace(/_/g, " "),
      createdAt: r.createdAt,
      decidableHere: !r.observed.project_id && !r.observed.meeting_id,
      candidates: r.candidates,
      field: null,
    })),
    ...inferences.map((i) => ({
      kind: "proposal" as const,
      id: i.id,
      companyId: i.companyId,
      companyName: i.companyName,
      title: proposalTitle(i.companyName, i.field, i.value),
      detail: i.field.startsWith("next_step:") ? "next step" : i.field.replace(/_/g, " "),
      createdAt: i.createdAt,
      decidableHere: i.field !== "stage_suggestion",
      candidates: [],
      field: i.field,
    })),
  ]

  const system: SystemItem[] = []
  const beat = cursors.find((c) => c.source === "whatsapp" && c.key === "heartbeat")?.cursor ?? null
  const beatMsg = heartbeatAlert(beat, now)
  if (beatMsg) system.push({ key: "whatsapp-heartbeat", message: beatMsg, since: beat })
  for (const name of CRON_NAMES) {
    const at = cursors.find((c) => c.source === "cron" && c.key === name)?.cursor ?? null
    if (at && now - Date.parse(at) > CRON_STALE_MS) {
      system.push({ key: `cron:${name}`, message: `O cron ${name} não roda desde ${at.slice(0, 16).replace("T", " ")} UTC.`, since: at })
    }
  }

  return { generatedAt: new Date(now).toISOString(), waitingYou, waitingClient, decisions, system }
}

/**
 * As pendências do resumo diário. Se a leitura falhar, o resumo ainda sai: listas
 * vazias, um alerta com o motivo e o batimento do coletor de WhatsApp (o único
 * aviso de que o coletor do PC morreu) lido direto do cursor.
 */
export async function openItemsForDigest(
  store: OpenItemsStore & { getCursor(source: string, key?: string): Promise<string | null> },
  now: number
): Promise<{ waitingYou: ConversationItem[]; waitingClient: ConversationItem[]; decisions: number; alerts: string[] }> {
  try {
    const items = await openItems(store, { now })
    return { waitingYou: items.waitingYou, waitingClient: items.waitingClient, decisions: items.decisions.length, alerts: items.system.map((s) => s.message) }
  } catch (e) {
    console.error("[digest] pendências não carregaram", e)
    const alerts = [`Pendências não carregaram: ${e instanceof Error ? e.message : String(e)}`]
    try {
      const beatMsg = heartbeatAlert(await store.getCursor("whatsapp", "heartbeat"), now)
      if (beatMsg) alerts.push(beatMsg)
    } catch {
      // sem o batimento: só o alerta de falha
    }
    return { waitingYou: [], waitingClient: [], decisions: 0, alerts }
  }
}
