// src/lib/whatsapp/contract.ts
// O contrato entre o coletor local de WhatsApp e o CRM. Sem import nenhum:
// o coletor (collectors/whatsapp) importa isto com `import type`.
//
// Regra do contrato: candidato leva só nome e número (ou nome do grupo), nunca
// mensagem. Mensagem só vai em WaDayEvent, e só de conversa já confirmada.

/** Chave estável da conversa: "p:+5521987654321" (1:1) ou "g:<id>@g.us" (grupo). */
export type WaChatKey = string

export interface WaDirectory {
  generatedAt: string
  /** Pessoas com nome e sobrenome. nameKey = normalizePersonName(nome completo). */
  people: { id: string; nameKey: string; companyId: string | null }[]
  /** Empresas do funil (com estágio). nameKey = companyNameKey(nome). */
  companies: { id: string; nameKey: string }[]
  /** Telefones já decididos. digits = as variantes sem "+" (com e sem o nono dígito). */
  phones: { digits: string[]; personId: string | null; ignored: boolean }[]
  groups: { groupId: string; companyId: string | null; ignored: boolean }[]
}

export type WaCandidate =
  | { type: "direct"; phone: string; contactName: string; personIds: string[] }
  | { type: "group"; groupId: string; groupName: string; companyIds: string[]; matchedBy: "nome" | "participante" }

export interface WaDayEvent {
  chatKey: WaChatKey
  chat: { type: "direct"; phone: string } | { type: "group"; groupId: string }
  chatName: string
  /** AAAA-MM-DD em São Paulo. */
  day: string
  direction: "received" | "sent"
  messageCount: number
  /** ISO da última mensagem deste sentido no dia. */
  lastAt: string
  /** "HH:MM Nome: texto", linhas em ordem, ≤ 4000 caracteres. */
  text: string
  lastMessage: { id: string; quote: string }
  /** Telefones (E.164) de quem falou deste lado no dia. */
  speakerPhones: string[]
}

export interface WaCandidatesResult {
  opened: number
  skipped: number
}

export interface WaEventsResult {
  recorded: number
  rejected: { chatKey: string; day: string; reason: string }[]
}
