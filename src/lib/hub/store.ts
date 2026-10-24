import type { Evidence, EventDirection, EventKind, EventSource, LegacyActivityType, ParticipantRef } from "@/lib/events/types"

// A fronteira entre a lógica do hub e o banco. A lógica (identidade, ingestão,
// política de inferências) só fala com esta interface; o Supabase implementa em
// supabase-store.ts e os testes usam memory-store.ts, que reproduz os índices
// únicos das migrações 019–021. É o memory-store que permite testar
// idempotência de verdade: rodar duas vezes e contar linhas.

export type IdentityKind = "email" | "phone" | "wa_id" | "calendar_name" | "speaker_name" | "github"
export type IdentityConfidence = "strong" | "confirmed" | "weak"

export interface IdentityRow {
  id: string
  personId: string | null
  ignored: boolean
  kind: IdentityKind
  valueNorm: string
  confidence: IdentityConfidence
}

export interface NewIdentity {
  personId: string | null
  ignored?: boolean
  kind: IdentityKind
  valueNorm: string
  valueRaw?: string | null
  source: string
  confidence: IdentityConfidence
  firstSeenActivityId?: string | null
}

export interface DomainRow {
  domain: string
  companyId: string | null
  ignored: boolean
}

export interface PersonRow {
  id: string
  firstName: string
  lastName: string
  fullName: string
  companyId: string | null
  email: string | null
}

export interface NewPerson {
  firstName: string
  lastName: string
  companyId: string | null
  currentCompany: string | null
  email: string | null
  /** Entra no dedup_key da 015, como no import e no find_or_create_person. */
  currentTitle?: string | null
}

export interface CompanyRow {
  id: string
  name: string
  nameKey: string | null
}

export interface CompanyContext {
  id: string
  name: string
  stageTitle: string | null
  championName: string | null
  economicBuyerName: string | null
  painHypothesis: string | null
  contextInferenceIds: Record<string, string>
  signals: string[]
  openNextSteps: { title: string; dueDate: string | null }[]
}

export interface ReviewCandidate {
  personId?: string
  companyId?: string
  label: string
  score: number
  reasons: string[]
}

export interface NewReview {
  dedupKey: string
  companyId: string | null
  reason: string
  observed: Record<string, unknown>
  candidates: ReviewCandidate[]
}

export interface ReviewRow extends NewReview {
  id: string
  status: "open" | "resolved" | "ignored"
}

export interface EventRow {
  idempotencyKey: string
  source: EventSource
  sourceId: string
  sourceVersion: string | null
  kind: EventKind
  type: LegacyActivityType
  companyId: string
  personId: string | null
  occurredAt: string
  direction: EventDirection
  clientEngaged: boolean
  engagementRule: string
  title: string
  description: string | null
  evidence: Evidence[]
  sourceMeetingId: string | null
  sourceAppUrl: string | null
  summary: unknown
  transcript: string | null
  processorVersion: string
}

export interface UpsertEventResult {
  id: string
  /** Linha nova. */
  created: boolean
  /** Já existia com outra source_version e foi atualizada. */
  versionChanged: boolean
}

export interface CalendarAttendee {
  email: string | null
  name: string | null
  responseStatus: string | null
  organizer: boolean
  self: boolean
  internal: boolean
}

export interface CalendarEventRow {
  id: string
  googleEventId: string
  icalUid: string | null
  recurringEventId: string | null
  summary: string | null
  startAt: string | null
  endAt: string | null
  status: string
  organizerEmail: string | null
  attendees: CalendarAttendee[]
  htmlLink: string | null
  meetLink: string | null
  etag: string | null
  /** `created` do Google: quando o convite foi feito. A religação precisa dele. */
  googleCreatedAt: string | null
  transcriptionMeetingId: string | null
}

export type NewCalendarEvent = Omit<CalendarEventRow, "id" | "transcriptionMeetingId">

export interface NewInference {
  companyId: string
  field: string
  value: unknown
  evidence: Evidence[]
  sourceActivityId: string
  sourceVersion: string
  model: string
  promptVersion: string
  status: "proposed" | "applied" | "rejected"
}

export interface InferenceRow extends Omit<NewInference, "status"> {
  id: string
  status: NewInference["status"] | "superseded"
}

export interface NewNextStep {
  companyId: string
  title: string
  description: string | null
  dueDate: string | null
  sourceRef: string
  sourceActivityId: string
  inferenceId: string | null
}

export interface NextStepRow {
  id: string
  companyId: string
  title: string
  description: string | null
  dueDate: string | null
  status: "pending" | "completed"
  sourceRef: string | null
  inferenceId: string | null
}

export interface NextStepPatch {
  title: string
  description: string | null
  dueDate: string | null
  sourceRef: string
  inferenceId: string | null
}

export interface NewSignal {
  companyId: string
  signalType: string
  capturedAt: string
  sourceActivityId: string
  inferenceId: string | null
  evidence: Evidence[]
}

export interface HubStore {
  readonly workspaceId: string

  // --- identidade ---
  findIdentity(kind: IdentityKind, valueNorm: string): Promise<IdentityRow | null>
  /** ON CONFLICT DO NOTHING: devolve a linha que ficou no banco (a nova ou a que já estava). */
  addIdentity(row: NewIdentity): Promise<IdentityRow>
  findDomain(domain: string): Promise<DomainRow | null>
  addDomain(row: { domain: string; companyId: string | null; ignored?: boolean; source: string }): Promise<DomainRow>
  getPerson(id: string): Promise<PersonRow | null>
  peopleInCompany(companyId: string): Promise<PersonRow[]>
  /** Respeita o dedup_key da 015: colidiu, devolve o cadastro existente. */
  createPerson(p: NewPerson): Promise<PersonRow>
  getCompany(id: string): Promise<CompanyRow | null>
  companiesByNameKey(key: string): Promise<CompanyRow[]>
  /** Dedup por dedup_key: a mesma observação não abre duas revisões. */
  openReview(r: NewReview): Promise<ReviewRow>
  /** Fecha o caso aberto (se houver) porque o próprio sync resolveu: ex. a reunião passou a casar. */
  closeReviewAuto(dedupKey: string, detail: string): Promise<void>

  // --- eventos ---
  upsertEvent(row: EventRow): Promise<UpsertEventResult>
  addParticipants(activityId: string, refs: ParticipantRef[]): Promise<void>
  /** GREATEST(last_client_event_at, occurredAt). */
  bumpClientEvent(companyId: string, occurredAt: string): Promise<void>
  setEventSummary(activityId: string, summary: unknown): Promise<void>

  // --- calendar ---
  upsertCalendarEvent(ev: NewCalendarEvent): Promise<CalendarEventRow>
  getCalendarEventByGoogleId(googleEventId: string): Promise<CalendarEventRow | null>
  calendarEventsOverlapping(fromISO: string, toISO: string): Promise<CalendarEventRow[]>
  linkCalendarCompany(calendarEventId: string, companyId: string, linkedBy: string): Promise<void>
  calendarCompanies(calendarEventId: string): Promise<string[]>

  // --- projetos do TranscriptionApp (022) ---
  /** Empresa ligada ao projeto; ignored = projeto interno, não desce para conta nenhuma. */
  tappProjectCompany(projectId: string): Promise<{ companyId: string | null; ignored: boolean } | null>
  /** Grava (ou troca) a ligação. companyId null + ignored = projeto interno. */
  linkTappProject(projectId: string, projectName: string | null, companyId: string | null, ignored: boolean): Promise<void>
  setCalendarTranscription(calendarEventId: string, meetingId: string): Promise<void>

  // --- inferências e aplicação ---
  companyContext(companyId: string): Promise<CompanyContext | null>
  insertInference(row: NewInference): Promise<{ row: InferenceRow; created: boolean }>
  hasInference(sourceActivityId: string, sourceVersion: string, field: string): Promise<boolean>
  /** Propostas abertas de versões anteriores da mesma origem viram superseded. */
  supersedeOlderInferences(sourceActivityId: string, currentVersion: string): Promise<number>
  /**
   * Propostas abertas do mesmo campo da mesma conta, menos a nova, viram
   * superseded: a fila mostra só a conclusão da reunião mais recente.
   */
  supersedePendingField(companyId: string, field: string, keepId: string): Promise<number>
  setCompanyField(
    companyId: string,
    field: "champion_name" | "economic_buyer_name" | "pain_hypothesis",
    value: string,
    inferenceId: string
  ): Promise<void>
  /** UNIQUE(company_id, signal_type): false se o sinal já existia. */
  insertSignal(s: NewSignal): Promise<boolean>
  /** UNIQUE(workspace_id, source_ref): false se o passo já existia. */
  insertNextStep(s: NewNextStep): Promise<boolean>
  /** Passos da empresa cujo source_ref começa com o prefixo (ex.: "tapp:<reunião>:"), abertos ou não. */
  nextStepsByRefPrefix(companyId: string, prefix: string): Promise<NextStepRow[]>
  updateNextStep(id: string, patch: NextStepPatch): Promise<void>
  /** Troca o status de uma inferência (ex.: a inferida que a revisão humana substituiu vira superseded). */
  setInferenceStatus(id: string, status: InferenceRow["status"]): Promise<void>
  /**
   * O sinal já existia por uma inferência (inference_id não nulo): passa a
   * apontar para a nova, com a evidência dela. Sinal capturado à mão (sem
   * inferência) não é tocado. true se trocou.
   */
  promoteSignal(companyId: string, signalType: string, s: { inferenceId: string; sourceActivityId: string; evidence: Evidence[] }): Promise<boolean>

  // --- cursores ---
  getCursor(source: string, key?: string): Promise<string | null>
  setCursor(source: string, cursor: string | null, key?: string): Promise<void>
}

// --- WhatsApp (025) -------------------------------------------------------

/** O cru que o diretório do coletor precisa; a normalização é do whatsapp-ingest. */
export interface WhatsappDirectorySource {
  people: { id: string; fullName: string; companyId: string | null }[]
  /** Só as do funil (com estágio). */
  companies: { id: string; name: string }[]
  phones: { valueNorm: string; personId: string | null; ignored: boolean }[]
  groups: { groupId: string; companyId: string | null; ignored: boolean }[]
}

export interface WhatsappStore {
  whatsappDirectorySource(): Promise<WhatsappDirectorySource>
  whatsappGroupCompany(groupId: string): Promise<{ companyId: string | null; ignored: boolean } | null>
  /** Grava (ou troca) a ligação. companyId null + ignored = grupo não comercial. */
  linkWhatsappGroup(groupId: string, groupName: string | null, companyId: string | null, ignored: boolean): Promise<void>
}
