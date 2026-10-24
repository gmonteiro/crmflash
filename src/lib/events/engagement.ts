import { createHash } from "crypto"
import type { EngagementFacts, EventKind } from "./types"

// QUEM AGIU. Esta tabela decide se um evento reseta o contador de dias sem
// contato. Errar para true faz conta morta parecer viva — o problema central
// do CRM —, então a regra é explícita, testada linha a linha (engagement.test.ts)
// e o id dela fica gravado no evento (activities.engagement_rule).
//
// Na dúvida, false. Um contador que avisa cedo demais custa uma olhada; um que
// avisa tarde demais custa a conta.

/** Mínimo de fala do cliente para uma reunião contar como ação dele (~1 min). */
export const CLIENT_SPOKE_MIN_CHARS = 300

/**
 * Sem diarização (o caso real: as gravações vêm sem falante), a voz do cliente
 * não aparece. Decisão do Gabriel (23/10/2026): a reunião conta como ação do
 * cliente quando casou com um convite que tem gente de fora, durou ao menos
 * 15 min e rendeu transcrição longa. Gravação de 2 min ou ditado curto no
 * horário do convite não passam. Com diarização, vale a regra das vozes.
 */
export const MEETING_WITH_INVITE_MIN_MINUTES = 15
export const MEETING_WITH_INVITE_MIN_CHARS = 3000

export interface EngagementDecision {
  clientEngaged: boolean
  rule: string
}

export function classifyEngagement(kind: EventKind, facts: EngagementFacts = {}): EngagementDecision {
  switch (kind) {
    case "email.received":
      if (facts.calendarNotice) return { clientEngaged: false, rule: "email.calendar_notice" }
      if (facts.autoReply) return { clientEngaged: false, rule: "email.auto_reply" }
      if (facts.fromClient) return { clientEngaged: true, rule: "email.inbound_human" }
      return { clientEngaged: false, rule: "email.inbound_not_client" }
    case "email.auto_reply":
      return { clientEngaged: false, rule: "email.auto_reply" }
    case "email.sent":
      return { clientEngaged: false, rule: "email.outbound" }

    case "whatsapp.received":
      return { clientEngaged: true, rule: "wa.inbound" }
    case "whatsapp.sent":
      return { clientEngaged: false, rule: "wa.outbound" }

    case "meeting.scheduled":
    case "meeting.rescheduled":
      // Quem convida é quem quer a reunião.
      return facts.organizerIsClient
        ? { clientEngaged: true, rule: "cal.client_invite" }
        : { clientEngaged: false, rule: "cal.lumeis_invite" }
    case "meeting.rsvp":
      // D4: aceitar o convite é um clique; a ação real é aparecer e falar.
      return { clientEngaged: false, rule: "cal.rsvp" }
    case "meeting.cancelled":
      return { clientEngaged: false, rule: "cal.cancelled" }

    case "meeting.held":
    case "transcript.ready":
      if ((facts.clientSpokenChars ?? 0) >= CLIENT_SPOKE_MIN_CHARS) return { clientEngaged: true, rule: "meeting.client_spoke" }
      // Com falantes identificados e o cliente calado, a evidência é contra: não cai no convite.
      if (!facts.diarized && facts.heldWithInvite) return { clientEngaged: true, rule: "meeting.held_with_invite" }
      return { clientEngaged: false, rule: "meeting.no_client_evidence" }
    case "meeting.unconfirmed":
      return { clientEngaged: false, rule: "meeting.unconfirmed" }

    case "call.connected":
      return { clientEngaged: true, rule: "call.connected" }
    case "call.no_answer":
      return { clientEngaged: false, rule: "call.no_answer" }

    case "issue.opened":
    case "issue.closed":
    case "document.linked":
    case "note":
      return { clientEngaged: false, rule: "ops.internal" }
  }
}

/**
 * A chave que impede o mesmo fato de virar duas linhas. Inclui a empresa porque
 * uma reunião com duas empresas vira um evento em cada timeline.
 */
export function idempotencyKey(source: string, sourceId: string, kind: string, companyId: string): string {
  return createHash("sha256").update(`${source}:${sourceId}:${kind}:${companyId}`).digest("hex")
}
