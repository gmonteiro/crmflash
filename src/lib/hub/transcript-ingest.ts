import { MEETING_WITH_INVITE_MIN_CHARS, MEETING_WITH_INVITE_MIN_MINUTES } from "@/lib/events/engagement"
import { recordEvent } from "@/lib/events/record"
import type { ParticipantRef } from "@/lib/events/types"
import { matchSpeakers, resolveObservation, reviewDedupKey, type MeetingParticipant } from "@/lib/identity/resolve"
import type { TappBundle, TranscriptionSource } from "@/lib/transcription/client"
import { EXTRACTION_MODEL, verifyExtraction, type Extractor, type TranscriptLine } from "./extraction"
import { applyExtraction, type ApplyStats } from "./policy"
import type { CalendarEventRow, HubStore } from "./store"

// Reunião do TranscriptionApp → evento meeting.held na conta + extração.
//
//   1. a empresa: a do projeto escolhido no app, se ele já foi ligado a uma
//      (022); senão a do convite — achado pelo google_calendar_event_id, ou
//      por sobreposição de horário (±15 min) e só se for UM candidato;
//   2. projeto ainda não ligado e sem convite → caso projeto_sem_empresa, um
//      por projeto (resolver liga o projeto e reprocessa as reuniões dele);
//   3. falantes em mundo fechado contra os participantes do convite;
//   4. quem agiu (engagement.ts): fala do cliente com diarização; sem ela,
//      convite com gente de fora + duração + transcrição longa;
//   5. versão nova da transcrição (ou primeira) → extração → política.

const OVERLAP_MS = 15 * 60 * 1000

export interface TranscriptIngestResult {
  meetingId: string
  status: "linked" | "no_calendar_event" | "no_company" | "pending_project" | "skipped_incomplete"
  companies: string[]
  extracted: boolean
  apply?: ApplyStats[]
  dropped?: number
}

/**
 * Quando a reunião aconteceu. Gravação do desktop ou importada vem sem
 * started_at: aí vale o created_at (a reunião é criada na hora de gravar).
 */
export function meetingWindow(b: TappSummaryTimes): { start: string; end: string } {
  const start = b.started_at ?? b.created_at ?? b.updated_at
  return { start, end: b.ended_at ?? start }
}
type TappSummaryTimes = Pick<TappBundle, "started_at" | "ended_at" | "updated_at" | "created_at">

async function findCalendarEvent(store: HubStore, b: TappBundle): Promise<{ ev: CalendarEventRow | null; ambiguous: boolean }> {
  if (b.google_calendar_event_id) {
    const ev = await store.getCalendarEventByGoogleId(b.google_calendar_event_id)
    if (ev) return { ev, ambiguous: false }
  }
  const w = meetingWindow(b)
  const start = new Date(w.start).getTime()
  const end = new Date(w.end).getTime()
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

  const when = meetingWindow(b)
  const mapping = b.project ? await store.tappProjectCompany(b.project.id) : null
  const projectCompany = mapping && !mapping.ignored ? mapping.companyId : null

  const found = await findCalendarEvent(store, b)
  const inviteCompanies = found.ev ? await store.calendarCompanies(found.ev.id) : []
  // Projeto escolhido no app vence o horário; à mão (attach_transcript) vence tudo.
  const chosen = opts.forceCompanyId ?? projectCompany
  const companies = chosen ? [chosen] : inviteCompanies
  // O convite só entra (participantes, regra de engajamento) se for da mesma conta.
  const ev = found.ev && (!chosen || inviteCompanies.includes(chosen)) ? found.ev : null
  const ambiguous = found.ambiguous

  if (!chosen && b.project && !mapping) {
    // Um caso por projeto, não por reunião: resolver liga o projeto inteiro.
    await store.openReview({
      dedupKey: reviewDedupKey("tapp_project", b.project.id),
      companyId: null,
      reason: "projeto_sem_empresa",
      observed: { project_id: b.project.id, project_name: b.project.name, meeting_id_exemplo: b.id, title: b.title, started_at: when.start },
      candidates: [],
    })
    if (!found.ev || inviteCompanies.length === 0) {
      return { meetingId, status: "pending_project", companies: [], extracted: false }
    }
  }

  if (!ev && !chosen) {
    await store.openReview({
      dedupKey: reviewDedupKey("meeting", b.id),
      companyId: null,
      reason: ambiguous ? "reuniao_com_varios_convites" : "reuniao_sem_convite",
      observed: { meeting_id: b.id, title: b.title, started_at: when.start, app_url: b.app_url },
      candidates: [],
    })
    return { meetingId, status: "no_calendar_event", companies: [], extracted: false }
  }
  if (companies.length === 0) {
    await store.openReview({
      dedupKey: reviewDedupKey("meeting", b.id),
      companyId: null,
      reason: "reuniao_sem_empresa",
      observed: { meeting_id: b.id, title: b.title, started_at: when.start, calendar_event: ev?.googleEventId },
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
  const diarized = new Set(b.utterances.map((u) => u.speaker_id)).size >= 2
  const minutes = (new Date(when.end).getTime() - new Date(when.start).getTime()) / 60000
  const heldWithInvite =
    !!ev &&
    ev.attendees.some((a) => !a.internal) &&
    minutes >= MEETING_WITH_INVITE_MIN_MINUTES &&
    b.transcript.length >= MEETING_WITH_INVITE_MIN_CHARS

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
      occurredAt: when.start,
      direction: "internal",
      title: `Reunião: ${b.title}`,
      facts: { clientSpokenChars: spoken, diarized, heldWithInvite },
      evidence: [
        {
          kind: "transcript",
          ref: b.id,
          url: b.app_url,
          locator: diarized
            ? `${spoken} caracteres de fala externa`
            : `sem falantes; ${Math.round(minutes)} min, ${b.transcript.length} caracteres` +
              (ev ? `, convite ${ev.googleEventId}` : ", sem convite"),
        },
      ],
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
      meetingDate: when.start,
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
      meetingDate: when.start,
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

export interface SyncOptions {
  /** Sem cursor (primeira rodada), começa daqui, não do início do histórico. */
  backfillDays?: number
  /** Para de pegar reunião nova depois disso; o cursor fica onde parou. */
  budgetMs?: number
  now?: () => number
}

/** A mesma janela da carga cheia do Calendar: reunião mais velha não tem convite para casar. */
export const TRANSCRIPT_BACKFILL_DAYS = 30
/** Folga dentro dos 300 s da função para gravar o cursor e responder. */
export const TRANSCRIPT_SYNC_BUDGET_MS = 240_000

/**
 * Puxa o que mudou no TranscriptionApp desde o cursor. O cursor só avança até
 * antes da primeira falha (updated_since é inclusivo), então uma extração que
 * caiu é refeita na próxima rodada — e as que deram certo não gastam modelo de
 * novo, porque needsExtraction olha a inferência da versão.
 *
 * Sem cursor, olha só os últimos TRANSCRIPT_BACKFILL_DAYS: o histórico inteiro
 * abriria um caso reuniao_sem_convite por reunião antiga. Estourado o
 * orçamento, para e grava o cursor na última reunião processada; a próxima
 * rodada continua dali.
 */
export async function syncTranscripts(
  store: HubStore,
  source: TranscriptionSource,
  extractor: Extractor,
  internal: Set<string>,
  opts: SyncOptions = {}
): Promise<SyncResult> {
  const now = opts.now ?? Date.now
  const started = now()
  const budget = opts.budgetMs ?? TRANSCRIPT_SYNC_BUDGET_MS
  const stored = await store.getCursor("transcription_app")
  const since =
    stored ?? new Date(started - (opts.backfillDays ?? TRANSCRIPT_BACKFILL_DAYS) * 24 * 60 * 60 * 1000).toISOString()
  const all = (await source.listUpdated(since)).sort((a, b) => a.updated_at.localeCompare(b.updated_at))
  const out: SyncResult = { processed: [], failed: [], cursor: stored }
  let firstFailure: string | null = null
  let lastDone: string | null = null

  for (const m of all) {
    if (now() - started > budget) break
    lastDone = m.updated_at
    try {
      out.processed.push(await ingestMeeting(store, source, extractor, m.id, internal))
    } catch (e) {
      out.failed.push({ meetingId: m.id, error: e instanceof Error ? e.message : String(e) })
      firstFailure ??= m.updated_at
    }
  }

  out.cursor = firstFailure ?? lastDone ?? stored
  if (out.cursor && out.cursor !== stored) await store.setCursor("transcription_app", out.cursor)
  return out
}
