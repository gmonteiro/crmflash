import pkg from "whatsapp-web.js"
import type { WaMessage } from "./aggregate"
import type { WaSource } from "./cycle"
import type { ChatInfo } from "./match"

// O único arquivo que toca o whatsapp-web.js. Expõe só leitura (WaSource);
// readonly-guard.test.ts falha se aparecer qualquer método de escrita.
//
// LID: o WhatsApp vem trocando o id das pessoas por um "@lid" sem telefone.
// O número sai de contact.number quando o WhatsApp o expõe; sem número, a
// conversa é ignorada (o matcher exige telefone para 1:1).

type Client = InstanceType<typeof pkg.Client>
type Chat = Awaited<ReturnType<Client["getChats"]>>[number]

const digitsOnly = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "") || null

export class ReadOnlyWhatsApp implements WaSource {
  private chats = new Map<string, Chat>()
  private names = new Map<string, string>()

  constructor(private client: Client, private myName: string) {}

  /** Nome para o cabeçalho do evento: o salvo na agenda, senão o do perfil, senão o número. */
  displayName(id: string): string | undefined {
    return this.names.get(id)
  }

  async listChats(): Promise<(ChatInfo & { id: string; lastActivity: number })[]> {
    const out: (ChatInfo & { id: string; lastActivity: number })[] = []
    for (const chat of await this.client.getChats()) {
      const id = chat.id._serialized
      this.chats.set(id, chat)
      if (chat.isGroup) {
        const participants = ((chat as unknown as { participants?: { id: { _serialized: string; user: string; server: string } }[] }).participants ?? [])
          .filter((p) => p.id.server === "c.us")
          .map((p) => p.id.user)
        this.names.set(id, chat.name)
        out.push({ id, type: "group", phoneDigits: null, groupId: id, name: chat.name, participantDigits: participants, lastActivity: chat.timestamp ?? 0 })
        continue
      }
      if (chat.id.server !== "c.us" && chat.id.server !== "lid") continue // status, newsletter, broadcast
      const contact = await chat.getContact()
      const phone = digitsOnly(contact.number) ?? (chat.id.server === "c.us" ? chat.id.user : null)
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
          authorDigits = digitsOnly(c.number)
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
