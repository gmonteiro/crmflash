import { splitNameAndEmail } from "@/lib/identity/normalize"

// Cliente mínimo da Gmail API v1, por fetch, como o do Calendar. Só lê
// metadados e o snippet (LGPD: o corpo do e-mail fica no Gmail; o CRM guarda
// cabeçalhos e um trecho curto como evidência) e envia o resumo diário.

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me"

export class HistoryExpiredError extends Error {}

export interface GmailHeader {
  name: string
  value: string
}

export interface GmailMessage {
  id: string
  threadId: string
  historyId?: string
  internalDate?: string // epoch ms, em string
  labelIds?: string[]
  snippet?: string
  payload?: { headers?: GmailHeader[] }
}

const METADATA_HEADERS = [
  "From",
  "To",
  "Cc",
  "Subject",
  "Date",
  "Message-ID",
  "In-Reply-To",
  "Auto-Submitted",
  "X-Autoreply",
  "X-Autorespond",
  "Precedence",
  "List-Id",
  "List-Unsubscribe",
]

async function gget<T>(token: string, path: string, params: URLSearchParams): Promise<T> {
  const res = await fetch(`${BASE}${path}?${params}`, { headers: { Authorization: `Bearer ${token}` } })
  if (res.status === 404 && path === "/history") throw new HistoryExpiredError("historyId expirado")
  if (!res.ok) throw new Error(`Gmail ${path} ${res.status}: ${await res.text()}`)
  return (await res.json()) as T
}

export async function gmailProfileHistoryId(token: string): Promise<string> {
  const p = await gget<{ historyId: string }>(token, "/profile", new URLSearchParams())
  return p.historyId
}

/** Carga cheia: ids das mensagens que batem com a busca (ex.: `newer_than:30d`). */
export async function listMessageIds(token: string, q: string, max = 2000): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({ q, maxResults: "500", includeSpamTrash: "false" })
    if (pageToken) params.set("pageToken", pageToken)
    const json = await gget<{ messages?: { id: string }[]; nextPageToken?: string }>(token, "/messages", params)
    ids.push(...(json.messages ?? []).map((m) => m.id))
    pageToken = json.nextPageToken
  } while (pageToken && ids.length < max)
  return ids.slice(0, max)
}

/** Incremental: ids de mensagens adicionadas desde o historyId. 404 → HistoryExpiredError. */
export async function historyMessageIds(token: string, startHistoryId: string): Promise<{ ids: string[]; historyId: string }> {
  const ids = new Set<string>()
  let pageToken: string | undefined
  let historyId = startHistoryId
  do {
    const params = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded", maxResults: "500" })
    if (pageToken) params.set("pageToken", pageToken)
    const json = await gget<{
      history?: { messagesAdded?: { message: { id: string } }[] }[]
      nextPageToken?: string
      historyId?: string
    }>(token, "/history", params)
    for (const h of json.history ?? []) for (const m of h.messagesAdded ?? []) ids.add(m.message.id)
    pageToken = json.nextPageToken
    historyId = json.historyId ?? historyId
  } while (pageToken)
  return { ids: [...ids], historyId }
}

export async function getMessageMetadata(token: string, id: string): Promise<GmailMessage | null> {
  const params = new URLSearchParams({ format: "metadata" })
  for (const h of METADATA_HEADERS) params.append("metadataHeaders", h)
  const res = await fetch(`${BASE}/messages/${encodeURIComponent(id)}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 404) return null // apagada entre o list e o get
  if (!res.ok) throw new Error(`Gmail message ${res.status}: ${await res.text()}`)
  return (await res.json()) as GmailMessage
}

/** Envia um e-mail HTML da própria conta (o resumo diário). */
export async function sendGmail(token: string, msg: { to: string; subject: string; html: string }): Promise<string> {
  const subject = `=?UTF-8?B?${Buffer.from(msg.subject, "utf8").toString("base64")}?=`
  const raw = [
    `To: ${msg.to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(msg.html, "utf8").toString("base64"),
  ].join("\r\n")
  const res = await fetch(`${BASE}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: Buffer.from(raw, "utf8").toString("base64url") }),
  })
  if (!res.ok) throw new Error(`Gmail send ${res.status}: ${await res.text()}`)
  return ((await res.json()) as { id: string }).id
}

// --- leitura da mensagem -------------------------------------------------

export interface ParsedAddress {
  email: string
  name: string | null
}

export interface ParsedMessage {
  id: string
  threadId: string
  /** ISO. internalDate é quando o Gmail recebeu/enviou; o cabeçalho Date pode mentir. */
  sentAt: string
  from: ParsedAddress | null
  to: ParsedAddress[]
  cc: ParsedAddress[]
  subject: string
  snippet: string
  labels: string[]
  /** Resposta automática: Auto-Submitted ≠ no, X-Autoreply, ou assunto de ausência. */
  autoReply: boolean
  /** Lista, newsletter, notificação: não é conversa com ninguém. */
  bulk: boolean
  /** Aviso do Google Agenda (RSVP, convite, atualização, cancelamento): não é conversa nem ação do cliente. */
  calendarNotice: boolean
}

/** "Ana <ana@x.com>, b@y.com" → endereços. Vírgula dentro de aspas não separa. */
export function parseAddressList(raw: string | undefined): ParsedAddress[] {
  if (!raw) return []
  const parts: string[] = []
  let cur = ""
  let quoted = false
  let angle = false
  for (const ch of raw) {
    if (ch === '"') quoted = !quoted
    if (ch === "<") angle = true
    if (ch === ">") angle = false
    if (ch === "," && !quoted && !angle) {
      parts.push(cur)
      cur = ""
    } else cur += ch
  }
  parts.push(cur)
  const out: ParsedAddress[] = []
  for (const p of parts) {
    const { name, email } = splitNameAndEmail(p.trim().replace(/^"|"(?=\s*<)/g, ""))
    if (email) out.push({ email, name: name?.replace(/^"|"$/g, "").trim() || null })
  }
  return out
}

const OOO_SUBJECT = /^(resposta autom[aá]tica|automatic reply|auto(matic)?[- ]?reply|out of (the )?office|fora do escrit[oó]rio|aus[eê]ncia|ausente|f[eé]rias)\b/i
// Avisos do Google Agenda por e-mail, em PT e EN: o prefixo, depois ":". "Aceitação da proposta" não casa.
// Mantido igual ao regex da migração 027.
export const CALENDAR_NOTICE_SUBJECT =
  /^(aceit[oa]|recusad[oa]|talvez|accepted|declined|tentative|convite( atualizado)?|invitation|updated invitation|(evento )?cancelado|cancell?ed event|nova proposta de hor[aá]rio|proposed new time)\s*:/i
const NOREPLY = /^(no-?reply|do-?not-?reply|nao-?responda|notifica(c|ç)(o|õ)es?|notifications?|mailer-daemon|postmaster|bounce)/i
const BULK_LABELS = ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS", "CATEGORY_UPDATES", "SPAM", "TRASH"]

/** O snippet vem com entidades HTML (&#39;, &quot;). */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

export function parseMessage(m: GmailMessage): ParsedMessage {
  const h = new Map((m.payload?.headers ?? []).map((x) => [x.name.toLowerCase(), x.value]))
  const from = parseAddressList(h.get("from"))[0] ?? null
  const subject = h.get("subject") ?? ""
  const labels = m.labelIds ?? []
  const autoSubmitted = (h.get("auto-submitted") ?? "no").toLowerCase()
  const precedence = (h.get("precedence") ?? "").toLowerCase()

  const autoReply =
    (autoSubmitted !== "no" && autoSubmitted.startsWith("auto-replied")) ||
    h.has("x-autoreply") ||
    h.has("x-autorespond") ||
    OOO_SUBJECT.test(subject.trim())
  const bulk =
    !autoReply &&
    (h.has("list-id") ||
      h.has("list-unsubscribe") ||
      ["bulk", "list", "junk"].includes(precedence) ||
      (autoSubmitted !== "no" && !autoSubmitted.startsWith("auto-replied")) ||
      (!!from && NOREPLY.test(from.email.slice(0, from.email.indexOf("@")))) ||
      labels.some((l) => BULK_LABELS.includes(l)))

  const calendarNotice =
    CALENDAR_NOTICE_SUBJECT.test(subject.trim()) ||
    (!!from && from.email.slice(0, from.email.indexOf("@")).toLowerCase() === "calendar-notification")

  return {
    id: m.id,
    threadId: m.threadId,
    sentAt: new Date(Number(m.internalDate ?? Date.now())).toISOString(),
    from,
    to: parseAddressList(h.get("to")),
    cc: parseAddressList(h.get("cc")),
    subject,
    snippet: decodeEntities(m.snippet ?? "").slice(0, 500),
    labels,
    autoReply,
    bulk,
    calendarNotice,
  }
}
