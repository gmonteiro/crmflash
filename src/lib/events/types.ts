// O envelope comum de "algo aconteceu com a conta X", qualquer que seja a
// origem. Vira uma linha de `activities` (migração 019).

export type EventSource =
  | "manual"
  | "mcp"
  | "transcription_app"
  | "calendar"
  | "gmail"
  | "whatsapp"
  | "github"
  | "drive"

export type EventKind =
  | "email.received"
  | "email.sent"
  | "email.auto_reply"
  | "call.connected"
  | "call.no_answer"
  | "meeting.scheduled"
  | "meeting.rescheduled"
  | "meeting.cancelled"
  | "meeting.rsvp"
  | "meeting.held"
  | "meeting.unconfirmed"
  | "transcript.ready"
  | "whatsapp.received"
  | "whatsapp.sent"
  | "issue.opened"
  | "issue.closed"
  | "document.linked"
  | "note"

export type EventDirection = "inbound" | "outbound" | "internal"

/** O tipo legado de `activities.type`, que a UI já sabe desenhar. */
export type LegacyActivityType = "meeting" | "call" | "email" | "note"

export interface Evidence {
  kind: "transcript" | "email" | "whatsapp" | "calendar" | "manual"
  /** id na origem: meeting_id, message_id, wamid, event_id */
  ref: string
  quote?: string
  locator?: string
  url?: string
}

export interface ParticipantRef {
  personId: string
  role: "from" | "to" | "cc" | "attendee" | "organizer" | "speaker" | "assignee"
}

/** O que o normalizador de cada fonte entrega. */
export interface HubEventInput {
  source: EventSource
  sourceId: string
  sourceVersion?: string | null
  kind: EventKind
  companyId: string
  personId?: string | null
  occurredAt: string
  direction: EventDirection
  title: string
  description?: string | null
  /** Fatos que a regra de engajamento lê. Ver engagement.ts. */
  facts?: EngagementFacts
  evidence?: Evidence[]
  participants?: ParticipantRef[]
  sourceMeetingId?: string | null
  sourceAppUrl?: string | null
  summary?: unknown
  transcript?: string | null
  /** Conversa de mensagem (e-mail por thread, WhatsApp por chat): a base de "sem retorno". */
  conversationKey?: string | null
}

export interface EngagementFacts {
  /** O organizador do convite é de fora da Lumeis. */
  organizerIsClient?: boolean
  /** RSVP do cliente. */
  rsvp?: "accepted" | "declined" | "tentative" | "needsAction"
  /** Caracteres falados por participantes de fora da Lumeis na transcrição. */
  clientSpokenChars?: number
  /** A transcrição tem falantes (duas ou mais vozes): a regra das vozes decide sozinha. */
  diarized?: boolean
  /**
   * Casou com convite que tem participante externo, durou o mínimo e rendeu
   * transcrição longa (MEETING_WITH_INVITE_MIN_*). Só vale sem diarização.
   */
  heldWithInvite?: boolean
  /** Cabeçalho Auto-Submitted, X-Autoreply, assunto de ausência. */
  autoReply?: boolean
  /** Aviso do Google Agenda por e-mail (RSVP, convite, cancelamento): D4, não é ação do cliente. */
  calendarNotice?: boolean
  /** O remetente é identidade ou domínio do cliente. */
  fromClient?: boolean
}

export function legacyType(kind: EventKind): LegacyActivityType {
  if (kind.startsWith("meeting.") || kind === "transcript.ready") return "meeting"
  if (kind.startsWith("call.")) return "call"
  if (kind.startsWith("email.")) return "email"
  return "note"
}
