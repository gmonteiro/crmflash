import { recordEvent } from "@/lib/events/record"
import type { ParticipantRef } from "@/lib/events/types"
import { matchSpeakers, resolveObservation, reviewDedupKey, type MeetingParticipant } from "@/lib/identity/resolve"
import type { TappBundle, TranscriptionSource } from "@/lib/transcription/client"
import { EXTRACTION_MODEL, verifyExtraction, type Extractor, type TranscriptLine } from "./extraction"
import { applyExtraction, type ApplyStats } from "./policy"
import type { CalendarEventRow, HubStore } from "./store"

// Reunião do TranscriptionApp → evento meeting.held na conta + extração.
//
//   1. acha o convite: pelo google_calendar_event_id; senão por sobreposição
//      de horário (±15 min) — e só se for UM convite candidato;
//   2. as empresas são as do convite (calendar-ingest já ligou);
//   3. falantes em mundo fechado contra os participantes do convite;
//   4. quem agiu: a reunião só conta como ação do cliente se houve fala de
//      alguém que não é da Lumeis (ver clientSpokenChars);
//   5. versão nova da transcrição (ou primeira) → extração → política.

const OVERLAP_MS = 15 * 60 * 1000

export interface TranscriptIngestResult {
  meetingId: string
  status: "linked" | "no_calendar_event" | "no_company" | "skipped_incomplete"
  companies: string[]
  extracted: boolean
  apply?: ApplyStats[]
  dropped?: number
}

async function findCalendarEvent(store: HubStore, b: TappBundle): Promise<{ ev: CalendarEventRow | null; ambiguous: boolean }> {
  if (b.google_calendar_event_id) {
    const ev = await store.getCalendarEventByGoogleId(b.google_calendar_event_id)
    if (ev) return { ev, ambiguous: false }
  }
  if (!b.started_at) return { ev: null, ambiguous: false }
  const start = new Date(b.started_at).getTime()
  const end = b.ended_at ? new Date(b.ended_at).getTime() : start
  const candidates = (
    await store.calendarEventsOverlapping(new Date(start - OVERLAP_MS).toISOString(), new Date(end + OVERLAP_MS).toISOString())
  ).filter((e) => e.status !== "cancelled" && (!e.transcriptionMeetingId || e.transcriptionMeetingId === b.id))
  if (candidates.length === 1) return { ev: candidates[0], ambiguous: false }
  return { ev: null, ambiguous: candidates.length > 1 }
}

function transcriptLines(b: TappBundle): TranscriptLine[] {
  const nameOf = new Map(b.speakers.map((s) => [s.id, s.name ?? s.label]))
  if (b.segments.length) {
    return b.segments.map((s) => ({
      segment: s.index,
      speaker: (s.speaker_id && nameOf.get(s.speaker_id)) || "?",
      text: s.text,
    }))
  }
  return b.transcript
    .split(/\n+/)
    .filter((t) => t.trim())
    .map((text, i) => ({ segment: i + 1, speaker: "?", text }))
}

/**
 * Quanto o cliente falou. O nome que o TranscriptionApp põe no falante nem
 * sempre corresponde à voz (o índice da diarização é arbitrário), então a
 * regra é conservadora pelo outro lado: com uma voz só — você ditando —, zero.
 * Com duas ou mais, conta tudo que não foi casado como Lumeis.
 */
export function clientSpokenChars(b: TappBundle, internalSpeakerIds: Set<string>): number {
  const voices = new Set(b.utterances.map((u) => u.speaker_id))
  if (voices.size < 2) return 0
  return b.utterances
    .filter((u) => !internalSpeakerIds.has(u.speaker_id))
    .reduce((n, u) => n + u.text.length, 0)
}

export async function ingestMeeting(
  store: HubStore,
  source: TranscriptionSource,
  extractor: Extractor,
  meetingId: string,
  internal: Set<string>,
  opts: { forceCompanyId?: string } = {}
): Promise<TranscriptIngestResult> {
  const b = await source.getBundle(meetingId)
  if (!b || b.status !== "completed" || !b.transcript.trim()) {
    return { meetingId, status: "skipped_incomplete", companies: [], extracted: false }
  }

  const { ev, ambiguous } = await findCalendarEvent(store, b)
  let companies: string[] = ev ? await store.calendarCompanies(ev.id) : []
  if (opts.forceCompanyId) companies = [opts.forceCompanyId]

  if (!ev && !opts.forceCompanyId) {
    await store.openReview({
      dedupKey: reviewDedupKey("meeting", b.id),
      companyId: null,
      reason: ambiguous ? "reuniao_com_varios_convites" : "reuniao_sem_convite",
      observed: { meeting_id: b.id, title: b.title, started_at: b.started_at, app_url: b.app_url },
      candidates: [],
    })
    return { meetingId, status: "no_calendar_event", companies: [], extracted: false }
  }
  if (companies.length === 0) {
    await store.openReview({
      dedupKey: reviewDedupKey("meeting", b.id),
      companyId: null,
      reason: "reuniao_sem_empresa",
      observed: { meeting_id: b.id, title: b.title, started_at: b.started_at, calendar_event: ev?.googleEventId },
      candidates: [],
    })
    return { meetingId, status: "no_company", companies: [], extracted: false }
  }
  if (ev) await store.setCalendarTranscription(ev.id, b.id)

  // Participantes do convite, já resolvidos (a escada é idempotente: aqui cai
  // no degrau 1 para quem o calendar-ingest já resolveu).
  const participants: MeetingParticipant[] = []
  for (const a of ev?.attendees ?? []) {
    if (a.internal) {
      participants.push({ personId: null, name: a.name, email: a.email, internal: true })
      continue
    }
    const r = a.email
      ? await resolveObservation(store, { email: a.email, name: a.name, source: "calendar", sourceRef: ev!.googleEventId }, internal)
      : null
    participants.push({ personId: r?.status === "linked" ? r.personId : null, name: a.name, email: a.email, internal: false })
  }

  const matches = matchSpeakers(
    b.speakers.map((s) => ({ id: s.id, name: s.name, email: s.email })),
    participants
  )
  const internalSpeakers = new Set(matches.filter((m) => m.status === "internal").map((m) => m.speakerId))
  const spoken = clientSpokenChars(b, internalSpeakers)

  const speakerRefs: ParticipantRef[] = matches
    .filter((m): m is Extract<typeof m, { status: "person" }> => m.status === "person")
    .map((m) => ({ personId: m.personId, role: "speaker" }))
  const attendeeRefs: ParticipantRef[] = participants
    .filter((p) => p.personId)
    .map((p) => ({ personId: p.personId!, role: "attendee" }))

  const lines = transcriptLines(b)
  const result: TranscriptIngestResult = { meetingId, status: "linked", companies, extracted: false, apply: [], dropped: 0 }

  for (const companyId of companies) {
    const recorded = await recordEvent(store, {
      source: "transcription_app",
      sourceId: b.id,
      sourceVersion: b.transcript_version,
      kind: "meeting.held",
      companyId,
      occurredAt: b.started_at ?? b.updated_at,
      direction: "internal",
      title: `Reunião: ${b.title}`,
      facts: { clientSpokenChars: spoken },
      evidence: [{ kind: "transcript", ref: b.id, url: b.app_url, locator: `${spoken} caracteres de fala externa` }],
      participants: [...attendeeRefs, ...speakerRefs],
      sourceMeetingId: b.id,
      sourceAppUrl: b.app_url,
      transcript: b.transcript,
    })

    // A mesma versão já extraída não gasta modelo de novo.
    if (!recorded.created && !recorded.versionChanged && !(await needsExtraction(store, recorded.id, b.transcript_version))) {
      continue
    }
    if (recorded.versionChanged) await store.supersedeOlderInferences(recorded.id, b.transcript_version)

    const company = await store.companyContext(companyId)
    if (!company) continue

    const raw = await extractor.extract({
      company,
      meetingTitle: b.title,
      meetingDate: b.started_at ?? b.updated_at,
      participants: participants.map((p) => ({
        name: p.name ?? p.email ?? "?",
        side: p.internal ? "lumeis" : "cliente",
        email: p.email,
      })),
      lines,
    })
    const { extraction, dropped } = verifyExtraction(raw, lines)
    result.dropped = (result.dropped ?? 0) + dropped.length

    const stats = await applyExtraction(store, company, extraction, {
      sourceActivityId: recorded.id,
      sourceVersion: b.transcript_version,
      meetingId: b.id,
      meetingDate: b.started_at ?? b.updated_at,
      appUrl: b.app_url,
      model: EXTRACTION_MODEL,
    })
    await store.setEventSummary(recorded.id, { text: extraction.summary, dropped })
    result.extracted = true
    result.apply!.push(stats)
  }

  return result
}

async function needsExtraction(store: HubStore, activityId: string, version: string): Promise<boolean> {
  return !(await store.hasInference(activityId, version, "summary"))
}

export interface SyncResult {
  processed: TranscriptIngestResult[]
  failed: { meetingId: string; error: string }[]
  cursor: string | null
}

/**
 * Puxa o que mudou no TranscriptionApp desde o cursor. O cursor só avança até
 * antes da primeira falha (updated_since é inclusivo), então uma extração que
 * caiu é refeita na próxima rodada — e as que deram certo não gastam modelo de
 * novo, porque needsExtraction olha a inferência da versão.
 */
export async function syncTranscripts(
  store: HubStore,
  source: TranscriptionSource,
  extractor: Extractor,
  internal: Set<string>
): Promise<SyncResult> {
  const since = await store.getCursor("transcription_app")
  const meetings = (await source.listUpdated(since)).sort((a, b) => a.updated_at.localeCompare(b.updated_at))
  const out: SyncResult = { processed: [], failed: [], cursor: since }
  let firstFailure: string | null = null

  for (const m of meetings) {
    try {
      out.processed.push(await ingestMeeting(store, source, extractor, m.id, internal))
    } catch (e) {
      out.failed.push({ meetingId: m.id, error: e instanceof Error ? e.message : String(e) })
      firstFailure ??= m.updated_at
    }
  }

  const last = meetings.at(-1)?.updated_at ?? since
  out.cursor = firstFailure ?? last
  if (out.cursor !== since) await store.setCursor("transcription_app", out.cursor)
  return out
}
