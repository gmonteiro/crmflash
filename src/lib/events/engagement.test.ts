import { describe, it, expect } from "vitest"
import { classifyEngagement, CLIENT_SPOKE_MIN_CHARS, idempotencyKey } from "./engagement"
import type { EngagementFacts, EventKind } from "./types"

// Uma linha por regra da tabela 4.3 do design. Se alguém mudar a decisão, o
// teste que quebra diz exatamente qual contrato mudou.
const TABLE: [EventKind, EngagementFacts, boolean, string][] = [
  ["email.received", { fromClient: true }, true, "email.inbound_human"],
  ["email.received", { fromClient: true, autoReply: true }, false, "email.auto_reply"],
  ["email.received", { fromClient: true, calendarNotice: true }, false, "email.calendar_notice"],
  ["email.received", { fromClient: false }, false, "email.inbound_not_client"],
  ["email.auto_reply", {}, false, "email.auto_reply"],
  ["email.sent", {}, false, "email.outbound"],
  ["whatsapp.received", {}, true, "wa.inbound"],
  ["whatsapp.sent", {}, false, "wa.outbound"],
  ["meeting.scheduled", { organizerIsClient: false }, false, "cal.lumeis_invite"],
  ["meeting.scheduled", { organizerIsClient: true }, true, "cal.client_invite"],
  ["meeting.rescheduled", { organizerIsClient: true }, true, "cal.client_invite"],
  ["meeting.rsvp", { rsvp: "accepted" }, false, "cal.rsvp"],
  ["meeting.cancelled", { organizerIsClient: true }, false, "cal.cancelled"],
  ["meeting.held", { clientSpokenChars: CLIENT_SPOKE_MIN_CHARS }, true, "meeting.client_spoke"],
  ["meeting.held", { clientSpokenChars: CLIENT_SPOKE_MIN_CHARS - 1 }, false, "meeting.no_client_evidence"],
  ["meeting.held", {}, false, "meeting.no_client_evidence"],
  ["transcript.ready", { clientSpokenChars: 5000 }, true, "meeting.client_spoke"],
  ["meeting.unconfirmed", {}, false, "meeting.unconfirmed"],
  ["call.connected", {}, true, "call.connected"],
  ["call.no_answer", {}, false, "call.no_answer"],
  ["issue.opened", {}, false, "ops.internal"],
  ["document.linked", {}, false, "ops.internal"],
  ["note", {}, false, "ops.internal"],
]

describe("classifyEngagement — quem agiu", () => {
  it.each(TABLE)("%s %j → %s (%s)", (kind, facts, engaged, rule) => {
    expect(classifyEngagement(kind, facts)).toEqual({ clientEngaged: engaged, rule })
  })

  it("follow-up meu, reunião que não aconteceu e e-mail sem resposta nunca contam", () => {
    expect(classifyEngagement("email.sent").clientEngaged).toBe(false)
    expect(classifyEngagement("meeting.unconfirmed").clientEngaged).toBe(false)
    expect(classifyEngagement("meeting.held", { clientSpokenChars: 0 }).clientEngaged).toBe(false)
  })
})

describe("idempotencyKey", () => {
  it("determinística e sensível a cada parte", () => {
    const k = idempotencyKey("calendar", "evt1", "meeting.scheduled", "co1")
    expect(k).toBe(idempotencyKey("calendar", "evt1", "meeting.scheduled", "co1"))
    expect(k).not.toBe(idempotencyKey("calendar", "evt1", "meeting.scheduled", "co2"))
    expect(k).not.toBe(idempotencyKey("calendar", "evt1", "meeting.held", "co1"))
    expect(k).toMatch(/^[0-9a-f]{64}$/)
  })
})
