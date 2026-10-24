import { recordEvent } from "@/lib/events/record"
import type { ParticipantRef } from "@/lib/events/types"
import { companyNameKey, normalizePersonName, normalizePhone, phoneVariants, personNameTokens } from "@/lib/identity/normalize"
import { reviewDedupKey } from "@/lib/identity/resolve"
import type { WaCandidate, WaCandidatesResult, WaDayEvent, WaDirectory, WaEventsResult } from "@/lib/whatsapp/contract"
import type { HubStore, ReviewCandidate, WhatsappStore } from "./store"

// WhatsApp → CRM, do lado do CRM. O coletor roda no PC do Gabriel e já casou
// as conversas lá (nada pessoal sai da máquina). Aqui:
//
//   - buildDirectory: o que o coletor precisa para casar;
//   - openCandidates: caso na fila com SÓ nome e número (ou nome do grupo);
//   - recordDays: o agregado do dia, revalidado — o CRM não confia no coletor
//     para dizer a empresa; ele mesmo resolve pela identidade ou pelo grupo.

export const WA_REVIEW_REASON_CONTACT = "whatsapp_contato"
export const WA_REVIEW_REASON_GROUP = "grupo_sem_empresa"

const digits = (e164: string) => e164.replace(/\D/g, "")

export async function buildDirectory(store: WhatsappStore): Promise<WaDirectory> {
  const src = await store.whatsappDirectorySource()
  return {
    generatedAt: new Date().toISOString(),
    people: src.people
      .filter((p) => personNameTokens(p.fullName.replace(/—/g, " ")).length >= 2)
      .map((p) => ({ id: p.id, nameKey: normalizePersonName(p.fullName)!, companyId: p.companyId })),
    companies: src.companies
      .map((c) => ({ id: c.id, nameKey: companyNameKey(c.name) }))
      .filter((c): c is { id: string; nameKey: string } => !!c.nameKey && c.nameKey.length >= 4),
    phones: src.phones.map((p) => ({ digits: phoneVariants(p.valueNorm).map(digits), personId: p.personId, ignored: p.ignored })),
    groups: src.groups,
  }
}

export async function openCandidates(store: HubStore & WhatsappStore, list: WaCandidate[]): Promise<WaCandidatesResult> {
  let opened = 0
  let skipped = 0
  const seen = new Set<string>()
  for (const c of list) {
    if (c.type === "direct") {
      const phone = normalizePhone(c.phone)
      if (!phone || seen.has(`p:${phone}`) || (await store.findIdentity("phone", phone))) {
        skipped++
        continue
      }
      seen.add(`p:${phone}`)
      const candidates: ReviewCandidate[] = []
      for (const id of c.personIds) {
        const p = await store.getPerson(id)
        if (p) candidates.push({ personId: p.id, label: p.fullName, score: 0.7, reasons: ["nome salvo no celular igual ao do CRM"] })
      }
      await store.openReview({
        dedupKey: reviewDedupKey("phone", phone),
        companyId: null,
        reason: WA_REVIEW_REASON_CONTACT,
        observed: { source: "whatsapp", phone, name: c.contactName },
        candidates,
      })
      opened++
      continue
    }

    if (seen.has(`g:${c.groupId}`) || (await store.whatsappGroupCompany(c.groupId))) {
      skipped++
      continue
    }
    seen.add(`g:${c.groupId}`)
    const candidates: ReviewCandidate[] = []
    for (const id of c.companyIds) {
      const co = await store.getCompany(id)
      if (!co) continue
      candidates.push({
        companyId: co.id,
        label: co.name,
        score: c.matchedBy === "nome" ? 0.8 : 0.6,
        reasons: [c.matchedBy === "nome" ? "o nome do grupo contém o nome da empresa" : "um participante é contato confirmado da empresa"],
      })
    }
    await store.openReview({
      dedupKey: reviewDedupKey("wa_group", c.groupId),
      companyId: candidates[0]?.companyId ?? null,
      reason: WA_REVIEW_REASON_GROUP,
      observed: { source: "whatsapp", group_id: c.groupId, group_name: c.groupName },
      candidates,
    })
    opened++
  }
  return { opened, skipped }
}

function hhmmSaoPaulo(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(
    new Date(iso)
  )
}

type ChatTarget = { companyId: string; personId: string | null } | { rejected: string }

async function resolveChat(store: HubStore & WhatsappStore, e: WaDayEvent): Promise<ChatTarget> {
  if (e.chat.type === "group") {
    const g = await store.whatsappGroupCompany(e.chat.groupId)
    if (!g) return { rejected: "conversa_nao_confirmada" }
    if (g.ignored || !g.companyId) return { rejected: "grupo_ignorado" }
    return { companyId: g.companyId, personId: null }
  }
  const phone = normalizePhone(e.chat.phone)
  if (!phone) return { rejected: "telefone_invalido" }
  for (const v of phoneVariants(phone)) {
    const id = await store.findIdentity("phone", v)
    if (!id) continue
    if (id.ignored || !id.personId) return { rejected: "contato_ignorado" }
    const person = await store.getPerson(id.personId)
    if (!person?.companyId) return { rejected: "pessoa_sem_empresa" }
    return { companyId: person.companyId, personId: person.id }
  }
  return { rejected: "conversa_nao_confirmada" }
}

export async function recordDays(store: HubStore & WhatsappStore, list: WaDayEvent[]): Promise<WaEventsResult> {
  const result: WaEventsResult = { recorded: 0, rejected: [] }
  for (const e of list) {
    const target = await resolveChat(store, e)
    if ("rejected" in target) {
      result.rejected.push({ chatKey: e.chatKey, day: e.day, reason: target.rejected })
      continue
    }

    // Quem falou deste lado, entre as pessoas já confirmadas.
    const participants: ParticipantRef[] = []
    if (e.direction === "received") {
      for (const raw of e.speakerPhones) {
        const phone = normalizePhone(raw)
        const id = phone ? await store.findIdentity("phone", phone) : null
        if (id?.personId && !id.ignored) participants.push({ personId: id.personId, role: "from" })
      }
      if (!participants.length && target.personId) participants.push({ personId: target.personId, role: "from" })
    }

    const received = e.direction === "received"
    await recordEvent(store, {
      source: "whatsapp",
      sourceId: `${e.chatKey}:${e.day}`,
      sourceVersion: String(e.messageCount),
      kind: received ? "whatsapp.received" : "whatsapp.sent",
      companyId: target.companyId,
      personId: target.personId,
      occurredAt: e.lastAt,
      direction: received ? "inbound" : "outbound",
      title: received ? `WhatsApp: ${e.chatName}` : `WhatsApp enviado: ${e.chatName}`,
      description: e.text || null,
      evidence: [
        {
          kind: "whatsapp",
          ref: e.lastMessage.id,
          quote: e.lastMessage.quote.slice(0, 280) || undefined,
          locator: `${e.chatName} às ${hhmmSaoPaulo(e.lastAt)}`,
        },
      ],
      participants,
    })
    result.recorded++
  }
  return result
}
