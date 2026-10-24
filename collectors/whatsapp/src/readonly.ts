import pkg from "whatsapp-web.js"
import type { WaMessage } from "./aggregate"
import type { WaSource } from "./cycle"
import type { ChatInfo } from "./match"

// O único arquivo que toca o whatsapp-web.js. Expõe só leitura (WaSource);
// readonly-guard.test.ts falha se aparecer qualquer método de escrita.
//
// LID: o WhatsApp vem trocando o id das pessoas por um "@lid" (14–15 dígitos
// que NÃO são telefone; contact.number devolve o LID nesses casos). O telefone
// sai de getContactLidAndPhone, que é leitura. Sem telefone, a conversa é
// ignorada (o matcher exige telefone para 1:1).

type Client = InstanceType<typeof pkg.Client>
type Chat = Awaited<ReturnType<Client["getChats"]>>[number]

const digitsOnly = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "") || null
/** "5521987654321@c.us" → "5521987654321". */
const userPart = (wid: string | null | undefined) => digitsOnly((wid ?? "").split("@")[0])

export class ReadOnlyWhatsApp implements WaSource {
  private chats = new Map<string, Chat>()
  private names = new Map<string, string>()
  /** LID serializado → dígitos do telefone (null: o WhatsApp não expôs). */
  private lidPhones = new Map<string, string | null>()

  constructor(private client: Client, private myName: string) {}

  /** Nome para o cabeçalho do evento: o salvo na agenda, senão o do perfil, senão o número. */
  displayName(id: string): string | undefined {
    return this.names.get(id)
  }

  /** Resolve LIDs para telefone, em lote, com cache. */
  private async resolveLids(lids: string[]): Promise<void> {
    const todo = [...new Set(lids)].filter((l) => !this.lidPhones.has(l))
    for (let i = 0; i < todo.length; i += 100) {
      const batch = todo.slice(i, i + 100)
      let rows: { lid: string; pn: string }[] = []
      try {
        rows = await this.client.getContactLidAndPhone(batch)
      } catch (e) {
        console.error("[WhatsApp] getContactLidAndPhone falhou:", e instanceof Error ? e.message : e)
      }
      const byLid = new Map(rows.map((r) => [r.lid, userPart(r.pn)]))
      for (const l of batch) this.lidPhones.set(l, byLid.get(l) ?? null)
    }
  }

  private async phoneOf(wid: { _serialized: string; user: string; server: string }): Promise<string | null> {
    if (wid.server === "c.us") return digitsOnly(wid.user)
    if (wid.server !== "lid") return null
    await this.resolveLids([wid._serialized])
    return this.lidPhones.get(wid._serialized) ?? null
  }

  async listChats(): Promise<(ChatInfo & { id: string; lastActivity: number })[]> {
    const out: (ChatInfo & { id: string; lastActivity: number })[] = []
    const chats = await this.client.getChats()
    type Part = { id: { _serialized: string; user: string; server: string } }
    const partsOf = (c: Chat) => (c as unknown as { participants?: Part[] }).participants ?? []
    await this.resolveLids(
      chats.flatMap((c) =>
        c.isGroup ? partsOf(c).filter((p) => p.id.server === "lid").map((p) => p.id._serialized) : c.id.server === "lid" ? [c.id._serialized] : []
      )
    )
    for (const chat of chats) {
      const id = chat.id._serialized
      this.chats.set(id, chat)
      if (chat.isGroup) {
        const participants: string[] = []
        for (const p of partsOf(chat)) {
          const d = await this.phoneOf(p.id)
          if (d) participants.push(d)
        }
        this.names.set(id, chat.name)
        out.push({ id, type: "group", phoneDigits: null, groupId: id, name: chat.name, participantDigits: participants, lastActivity: chat.timestamp ?? 0 })
        continue
      }
      if (chat.id.server !== "c.us" && chat.id.server !== "lid") continue // status, newsletter, broadcast
      const contact = await chat.getContact()
      const phone = await this.phoneOf(chat.id)
      const saved = contact.isMyContact ? contact.name ?? null : null
      this.names.set(id, saved ?? contact.pushname ?? (phone ? `+${phone}` : id))
      out.push({ id, type: "direct", phoneDigits: phone, groupId: null, name: saved, participantDigits: [], lastActivity: chat.timestamp ?? 0 })
    }
    return out
  }

  async messagesSince(chatId: string, sinceSeconds: number): Promise<WaMessage[]> {
    const chat = this.chats.get(chatId) ?? (await this.client.getChatById(chatId))
    // fetchMessages não marca como lida. Busca em degraus até cobrir o período.
    let limit = 100
    let msgs = await chat.fetchMessages({ limit })
    while (msgs.length === limit && msgs[0].timestamp > sinceSeconds && limit < 3200) {
      limit *= 2
      msgs = await chat.fetchMessages({ limit })
    }
    const out: WaMessage[] = []
    for (const m of msgs) {
      if (m.timestamp < sinceSeconds) continue
      let authorDigits: string | null = null
      let authorName = this.myName
      if (!m.fromMe) {
        try {
          const c = await m.getContact()
          authorDigits = await this.phoneOf(c.id)
          authorName = (c.isMyContact ? c.name : null) ?? c.pushname ?? (authorDigits ? `+${authorDigits}` : "?")
        } catch {
          authorName = "?"
        }
      }
      out.push({
        id: m.id._serialized,
        timestamp: m.timestamp,
        fromMe: m.fromMe,
        authorDigits,
        authorName,
        type: m.type,
        body: m.body ?? "",
        fileName: (m as unknown as { _data?: { filename?: string } })._data?.filename ?? null,
      })
    }
    return out
  }
}
