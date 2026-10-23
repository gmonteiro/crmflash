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

export interface EngagementDecision {
  clientEngaged: boolean
  rule: string
}

export function classifyEngagement(kind: EventKind, facts: EngagementFacts = {}): EngagementDecision {
  switch (kind) {
    case "email.received":
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
      return (facts.clientSpokenChars ?? 0) >= CLIENT_SPOKE_MIN_CHARS
        ? { clientEngaged: true, rule: "meeting.client_spoke" }
        : { clientEngaged: false, rule: "meeting.no_client_evidence" }
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
