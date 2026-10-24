import type { WaDayEvent } from "../../../src/lib/whatsapp/contract"
import { saoPauloDay, saoPauloHHMM } from "./day"
import type { WaDayEventChat } from "./match"

// Mensagens de uma conversa → um evento por dia (São Paulo) por sentido.
// O texto do dia (as duas vozes) vai nos dois eventos: é o que a revisão
// diária lê. O sentido decide só quem agiu.

export interface WaMessage {
  id: string
  timestamp: number
  fromMe: boolean
  authorDigits: string | null
  authorName: string
  type: string
  body: string
  fileName: string | null
}

export const TEXT_LIMIT = 4000
const QUOTE_LIMIT = 280

const SKIP = new Set(["revoked", "e2e_notification", "notification", "notification_template", "gp2", "call_log", "protocol", "ciphertext"])

function render(msg: WaMessage): string | null {
  if (SKIP.has(msg.type)) return null
  switch (msg.type) {
    case "chat":
      return msg.body.trim() || null
    case "ptt":
    case "audio":
      return "[áudio]"
    case "image":
      return msg.body.trim() ? `[imagem] ${msg.body.trim()}` : "[imagem]"
    case "video":
      return msg.body.trim() ? `[vídeo] ${msg.body.trim()}` : "[vídeo]"
    case "document":
      return `[arquivo: ${msg.fileName ?? "sem nome"}]`
    case "sticker":
      return "[figurinha]"
    default:
      return msg.body.trim() || `[${msg.type}]`
  }
}

/** Mantém o fim: a conversa mais recente é a que importa para o próximo passo. */
function clip(text: string): string {
  if (text.length <= TEXT_LIMIT) return text
  const tail = text.slice(text.length - (TEXT_LIMIT - 1))
  const cut = tail.indexOf("\n")
  return `…${cut >= 0 && cut < 200 ? tail.slice(cut) : tail}`
}

export function aggregateDays(
  chatKey: string,
  chat: WaDayEventChat,
  chatName: string,
  messages: WaMessage[],
  internalDigits: Set<string>
): WaDayEvent[] {
  const byDay = new Map<string, { msg: WaMessage; line: string; ours: boolean }[]>()
  for (const msg of [...messages].sort((a, b) => a.timestamp - b.timestamp)) {
    const content = render(msg)
    if (!content) continue
    const ours = msg.fromMe || (!!msg.authorDigits && internalDigits.has(msg.authorDigits))
    const day = saoPauloDay(msg.timestamp)
    const list = byDay.get(day) ?? []
    list.push({ msg, line: `${saoPauloHHMM(msg.timestamp)} ${msg.authorName}: ${content}`, ours })
    byDay.set(day, list)
  }

  const out: WaDayEvent[] = []
  for (const [day, items] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const text = clip(items.map((i) => i.line).join("\n"))
    for (const direction of ["received", "sent"] as const) {
      const side = items.filter((i) => (direction === "sent" ? i.ours : !i.ours))
      if (!side.length) continue
      const last = side[side.length - 1].msg
      out.push({
        chatKey,
        chat,
        chatName,
        day,
        direction,
        messageCount: side.length,
        lastAt: new Date(last.timestamp * 1000).toISOString(),
        text,
        lastMessage: { id: last.id, quote: (render(last) ?? "").slice(0, QUOTE_LIMIT) },
        speakerPhones:
          direction === "received" ? [...new Set(side.map((i) => i.msg.authorDigits).filter((d): d is string => !!d))].map((d) => `+${d}`) : [],
      })
    }
  }
  return out
}
