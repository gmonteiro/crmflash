import type { WaCandidate, WaDayEvent } from "../../../src/lib/whatsapp/contract"
import { groupKey, nameKey, type DirectoryIndex } from "./directory"

// Roda no PC. Decide, conversa a conversa, o que pode sair da máquina:
//   linked    → mensagens vão para o CRM;
//   candidate → só nome e número (ou nome do grupo) vão para a fila;
//   ignored   → nada sai.
// Na dúvida, ignored: uma conversa pessoal enviada não volta atrás.

export type WaDayEventChat = WaDayEvent["chat"]

export interface ChatInfo {
  type: "direct" | "group"
  phoneDigits: string | null
  groupId: string | null
  name: string | null
  participantDigits: string[]
}

export type MatchResult =
  | { status: "linked"; chatKey: string; chat: WaDayEventChat }
  | { status: "candidate"; chatKey: string; candidate: WaCandidate }
  | { status: "ignored"; why: string }

export function chatKeyOf(c: ChatInfo): string | null {
  if (c.type === "group") return c.groupId ? `g:${c.groupId}` : null
  return c.phoneDigits ? `p:+${c.phoneDigits}` : null
}

/** Celular brasileiro sem o nono dígito ganha o 9, como o normalizePhone do CRM. */
function canonicalDigits(d: string): string {
  const m = d.match(/^55(\d{2})([6-9]\d{7})$/)
  return m ? `55${m[1]}9${m[2]}` : d
}

export function matchChat(c: ChatInfo, idx: DirectoryIndex): MatchResult {
  if (c.type === "direct") {
    if (!c.phoneDigits) return { status: "ignored", why: "sem_numero" }
    const known = idx.personByPhone.get(c.phoneDigits) ?? idx.personByPhone.get(canonicalDigits(c.phoneDigits))
    const phone = `+${canonicalDigits(c.phoneDigits)}`
    const chatKey = `p:${phone}`
    if (known) {
      if (known.ignored || !known.personId) return { status: "ignored", why: "telefone_ignorado" }
      return { status: "linked", chatKey, chat: { type: "direct", phone } }
    }
    const key = c.name ? nameKey(c.name) : null
    if (!key || key.split(" ").length < 2) return { status: "ignored", why: "sem_nome_completo" }
    const people = idx.peopleByName.get(key)
    if (!people?.length) return { status: "ignored", why: "nome_nao_casou" }
    return {
      status: "candidate",
      chatKey,
      candidate: { type: "direct", phone, contactName: c.name!, personIds: people.map((p) => p.id) },
    }
  }

  if (!c.groupId) return { status: "ignored", why: "sem_id" }
  const chatKey = `g:${c.groupId}`
  const known = idx.groupById.get(c.groupId)
  if (known) {
    if (known.ignored || !known.companyId) return { status: "ignored", why: "grupo_ignorado" }
    return { status: "linked", chatKey, chat: { type: "group", groupId: c.groupId } }
  }

  const name = c.name ?? ""
  const gk = ` ${groupKey(name)} `
  const byName = idx.companies.filter((co) => gk.includes(` ${co.nameKey} `)).map((co) => co.id)
  if (byName.length) {
    return {
      status: "candidate",
      chatKey,
      candidate: { type: "group", groupId: c.groupId, groupName: name, companyIds: byName, matchedBy: "nome" },
    }
  }

  const byMember = new Set<string>()
  for (const d of c.participantDigits) {
    const p = idx.personByPhone.get(d) ?? idx.personByPhone.get(canonicalDigits(d))
    const companyId = p?.personId && !p.ignored ? idx.companyByPersonId.get(p.personId) : null
    if (companyId) byMember.add(companyId)
  }
  if (byMember.size) {
    return {
      status: "candidate",
      chatKey,
      candidate: { type: "group", groupId: c.groupId, groupName: name, companyIds: [...byMember], matchedBy: "participante" },
    }
  }
  return { status: "ignored", why: "grupo_sem_sinal" }
}
