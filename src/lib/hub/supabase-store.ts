import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { personDedupKey } from "@/lib/import/dedup-key"
import type { Evidence, ParticipantRef } from "@/lib/events/types"
import type {
  CalendarEventRow,
  CompanyContext,
  DomainRow,
  EventRow,
  HubStore,
  IdentityKind,
  IdentityRow,
  InferenceRow,
  NewCalendarEvent,
  NewIdentity,
  NewInference,
  NewNextStep,
  NewPerson,
  NewReview,
  NewSignal,
  NextStepPatch,
  NextStepRow,
  PersonRow,
  ReviewRow,
  UpsertEventResult,
} from "./store"

// HubStore sobre o Supabase, com service role (o hub roda em cron, sem
// usuário logado). Por isso TODA escrita passa workspace_id explícito:
// default_workspace() depende de auth.uid(), que aqui é nulo. user_id é a
// autoria: o INTEGRATION_USER_ID, como já fazia /api/integration.

const UNIQUE_VIOLATION = "23505"

type Row = Record<string, unknown>

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what}: ${error?.message ?? "erro desconhecido"}`)
}

function toIdentity(r: Row): IdentityRow {
  return {
    id: r.id as string,
    personId: (r.person_id as string) ?? null,
    ignored: !!r.ignored,
    kind: r.kind as IdentityKind,
    valueNorm: r.value_norm as string,
    confidence: r.confidence as IdentityRow["confidence"],
  }
}

function toPerson(r: Row): PersonRow {
  return {
    id: r.id as string,
    firstName: r.first_name as string,
    lastName: r.last_name as string,
    fullName: r.full_name as string,
    companyId: (r.company_id as string) ?? null,
    email: (r.email as string) ?? null,
  }
}

function toCalendar(r: Row): CalendarEventRow {
  return {
    id: r.id as string,
    googleEventId: r.google_event_id as string,
    icalUid: (r.ical_uid as string) ?? null,
    recurringEventId: (r.recurring_event_id as string) ?? null,
    summary: (r.summary as string) ?? null,
    startAt: (r.start_at as string) ?? null,
    endAt: (r.end_at as string) ?? null,
    status: r.status as string,
    organizerEmail: (r.organizer_email as string) ?? null,
    attendees: (r.attendees as CalendarEventRow["attendees"]) ?? [],
    htmlLink: (r.html_link as string) ?? null,
    meetLink: (r.meet_link as string) ?? null,
    etag: (r.etag as string) ?? null,
    googleCreatedAt: (r.google_created_at as string) ?? null,
    transcriptionMeetingId: (r.transcription_meeting_id as string) ?? null,
  }
}

const PERSON_COLS = "id, first_name, last_name, full_name, company_id, email"
const CAL_COLS =
  "id, google_event_id, ical_uid, recurring_event_id, summary, start_at, end_at, status, organizer_email, attendees, html_link, meet_link, etag, google_created_at, transcription_meeting_id"

export class SupabaseHubStore implements HubStore {
  constructor(
    private readonly db: SupabaseClient,
    readonly workspaceId: string,
    private readonly authorId: string | null
  ) {}

  /** Cliente service role + o workspace do INTEGRATION_USER_ID. */
  static async fromEnv(): Promise<SupabaseHubStore> {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const userId = process.env.INTEGRATION_USER_ID
    if (!userId) throw new Error("INTEGRATION_USER_ID não configurado")
    const { data, error } = await db.from("workspace_members").select("workspace_id").eq("user_id", userId).maybeSingle()
    if (error || !data) fail("workspace do INTEGRATION_USER_ID", error)
    return new SupabaseHubStore(db, data.workspace_id as string, userId)
  }

  private ws<T extends Row>(row: T): T & { workspace_id: string } {
    return { ...row, workspace_id: this.workspaceId }
  }

  // --- identidade ---------------------------------------------------------

  async findIdentity(kind: IdentityKind, valueNorm: string) {
    const { data, error } = await this.db
      .from("person_identities")
      .select("id, person_id, ignored, kind, value_norm, confidence")
      .eq("workspace_id", this.workspaceId)
      .eq("kind", kind)
      .eq("value_norm", valueNorm)
      .maybeSingle()
    if (error) fail("findIdentity", error)
    return data ? toIdentity(data) : null
  }

  async addIdentity(row: NewIdentity) {
    const { error } = await this.db.from("person_identities").insert(
      this.ws({
        person_id: row.personId,
        ignored: row.ignored ?? false,
        kind: row.kind,
        value_norm: row.valueNorm,
        value_raw: row.valueRaw ?? null,
        source: row.source,
        confidence: row.confidence,
        first_seen_activity_id: row.firstSeenActivityId ?? null,
      })
    )
    if (error && error.code !== UNIQUE_VIOLATION) fail("addIdentity", error)
    const stored = await this.findIdentity(row.kind, row.valueNorm)
    if (!stored) fail("addIdentity: linha sumiu", null)
    return stored
  }

  async findDomain(domain: string): Promise<DomainRow | null> {
    const { data, error } = await this.db
      .from("company_domains")
      .select("domain, company_id, ignored")
      .eq("workspace_id", this.workspaceId)
      .eq("domain", domain)
      .maybeSingle()
    if (error) fail("findDomain", error)
    return data ? { domain: data.domain, companyId: data.company_id ?? null, ignored: !!data.ignored } : null
  }

  async addDomain(row: { domain: string; companyId: string | null; ignored?: boolean; source: string }) {
    const { error } = await this.db.from("company_domains").insert(
      this.ws({ domain: row.domain, company_id: row.companyId, ignored: row.ignored ?? false, source: row.source })
    )
    if (error && error.code !== UNIQUE_VIOLATION) fail("addDomain", error)
    return (await this.findDomain(row.domain))!
  }

  async getPerson(id: string) {
    const { data, error } = await this.db.from("people").select(PERSON_COLS).eq("id", id).maybeSingle()
    if (error) fail("getPerson", error)
    return data ? toPerson(data) : null
  }

  async peopleInCompany(companyId: string) {
    const { data, error } = await this.db
      .from("people")
      .select(PERSON_COLS)
      .eq("workspace_id", this.workspaceId)
      .eq("company_id", companyId)
      .limit(1000)
    if (error) fail("peopleInCompany", error)
    return (data ?? []).map(toPerson)
  }

  async createPerson(p: NewPerson) {
    const { data, error } = await this.db
      .from("people")
      .insert(
        this.ws({
          user_id: this.authorId,
          first_name: p.firstName,
          last_name: p.lastName,
          company_id: p.companyId,
          current_company: p.currentCompany,
          current_title: p.currentTitle ?? null,
          email: p.email,
        })
      )
      .select(PERSON_COLS)
      .single()
    if (!error) return toPerson(data)
    if (error.code !== UNIQUE_VIOLATION) fail("createPerson", error)
    // dedup_key (015): a pessoa já existe com esse nome+empresa.
    const key = personDedupKey({
      first_name: p.firstName,
      last_name: p.lastName,
      current_title: p.currentTitle ?? null,
      current_company: p.currentCompany,
    })
    const { data: existing } = await this.db
      .from("people")
      .select(PERSON_COLS)
      .eq("workspace_id", this.workspaceId)
      .eq("dedup_key", key)
      .maybeSingle()
    if (!existing) fail("createPerson: colisão sem linha", error)
    return toPerson(existing)
  }

  async getCompany(id: string) {
    const { data, error } = await this.db.from("companies").select("id, name, name_key").eq("id", id).maybeSingle()
    if (error) fail("getCompany", error)
    return data ? { id: data.id, name: data.name, nameKey: data.name_key ?? null } : null
  }

  async companiesByNameKey(key: string) {
    const { data, error } = await this.db
      .from("companies")
      .select("id, name, name_key")
      .eq("workspace_id", this.workspaceId)
      .eq("name_key", key)
      .limit(10)
    if (error) fail("companiesByNameKey", error)
    return (data ?? []).map((c) => ({ id: c.id, name: c.name, nameKey: c.name_key ?? null }))
  }

  async openReview(r: NewReview): Promise<ReviewRow> {
    const { error } = await this.db.from("identity_reviews").insert(
      this.ws({
        dedup_key: r.dedupKey,
        company_id: r.companyId,
        reason: r.reason,
        observed: r.observed,
        candidates: r.candidates,
      })
    )
    if (error && error.code !== UNIQUE_VIOLATION) fail("openReview", error)
    const { data, error: readError } = await this.db
      .from("identity_reviews")
      .select("id, dedup_key, company_id, reason, observed, candidates, status")
      .eq("workspace_id", this.workspaceId)
      .eq("dedup_key", r.dedupKey)
      .single()
    if (readError) fail("openReview: releitura", readError)
    return {
      id: data.id,
      dedupKey: data.dedup_key,
      companyId: data.company_id,
      reason: data.reason,
      observed: data.observed,
      candidates: data.candidates,
      status: data.status,
    }
  }

  // --- eventos ------------------------------------------------------------

  async upsertEvent(row: EventRow): Promise<UpsertEventResult> {
    const payload = this.ws({
      user_id: this.authorId,
      company_id: row.companyId,
      person_id: row.personId,
      type: row.type,
      title: row.title,
      description: row.description,
      date: row.occurredAt,
      occurred_at: row.occurredAt,
      source: row.source,
      source_id: row.sourceId,
      source_version: row.sourceVersion,
      kind: row.kind,
      idempotency_key: row.idempotencyKey,
      direction: row.direction,
      client_engaged: row.clientEngaged,
      engagement_rule: row.engagementRule,
      evidence: row.evidence,
      source_meeting_id: row.sourceMeetingId,
      source_app_url: row.sourceAppUrl,
      summary: row.summary,
      transcript: row.transcript,
      processor_version: row.processorVersion,
    })

    const existing = await this.eventByKey(row.idempotencyKey)
    if (!existing) {
      const { data, error } = await this.db.from("activities").insert(payload).select("id").single()
      if (!error) return { id: data.id, created: true, versionChanged: false }
      if (error.code !== UNIQUE_VIOLATION) fail("upsertEvent insert", error)
      // Corrida entre duas execuções do cron: a outra ganhou.
      const raced = await this.eventByKey(row.idempotencyKey)
      return { id: raced!.id, created: false, versionChanged: false }
    }

    if ((existing.source_version ?? null) === (row.sourceVersion ?? null)) {
      if (existing.engagement_rule !== row.engagementRule) {
        // Mesmo fato, regra de engajamento nova (ex.: meeting.held_with_invite):
        // reclassifica só quem agiu e a evidência; o resto da linha fica.
        const { error } = await this.db
          .from("activities")
          .update({ client_engaged: row.clientEngaged, engagement_rule: row.engagementRule, evidence: row.evidence })
          .eq("id", existing.id)
        if (error) fail("upsertEvent reclassify", error)
      }
      return { id: existing.id, created: false, versionChanged: false }
    }
    // O resumo é escrito pela extração depois; não apagar o da versão anterior aqui.
    const { summary: _summary, ...update } = payload
    void _summary
    const { error } = await this.db.from("activities").update(update).eq("id", existing.id)
    if (error) fail("upsertEvent update", error)
    return { id: existing.id, created: false, versionChanged: true }
  }

  private async eventByKey(
    key: string
  ): Promise<{ id: string; source_version: string | null; engagement_rule: string | null } | null> {
    const { data, error } = await this.db
      .from("activities")
      .select("id, source_version, engagement_rule")
      .eq("workspace_id", this.workspaceId)
      .eq("idempotency_key", key)
      .maybeSingle()
    if (error) fail("eventByKey", error)
    return data
  }

  async addParticipants(activityId: string, refs: ParticipantRef[]) {
    if (!refs.length) return
    const rows = refs.map((r) => this.ws({ activity_id: activityId, person_id: r.personId, role: r.role }))
    const { error } = await this.db
      .from("activity_participants")
      .upsert(rows, { onConflict: "activity_id,person_id,role", ignoreDuplicates: true })
    if (error) fail("addParticipants", error)
  }

  async bumpClientEvent(companyId: string, occurredAt: string) {
    const { error } = await this.db.rpc("bump_client_event", { p_company_id: companyId, p_occurred_at: occurredAt })
    if (error) fail("bump_client_event", error)
  }

  async setEventSummary(activityId: string, summary: unknown) {
    const { error } = await this.db.from("activities").update({ summary }).eq("id", activityId)
    if (error) fail("setEventSummary", error)
  }

  // --- calendar -----------------------------------------------------------

  async upsertCalendarEvent(ev: NewCalendarEvent) {
    const { data, error } = await this.db
      .from("calendar_events")
      .upsert(
        this.ws({
          google_event_id: ev.googleEventId,
          ical_uid: ev.icalUid,
          recurring_event_id: ev.recurringEventId,
          summary: ev.summary,
          start_at: ev.startAt,
          end_at: ev.endAt,
          status: ev.status,
          organizer_email: ev.organizerEmail,
          attendees: ev.attendees,
          html_link: ev.htmlLink,
          meet_link: ev.meetLink,
          etag: ev.etag,
          google_created_at: ev.googleCreatedAt,
          last_synced_at: new Date().toISOString(),
        }),
        { onConflict: "workspace_id,google_event_id" }
      )
      .select(CAL_COLS)
      .single()
    if (error) fail("upsertCalendarEvent", error)
    return toCalendar(data)
  }

  async getCalendarEventByGoogleId(googleEventId: string) {
    const { data, error } = await this.db
      .from("calendar_events")
      .select(CAL_COLS)
      .eq("workspace_id", this.workspaceId)
      .eq("google_event_id", googleEventId)
      .maybeSingle()
    if (error) fail("getCalendarEventByGoogleId", error)
    return data ? toCalendar(data) : null
  }

  async calendarEventsOverlapping(fromISO: string, toISO: string) {
    const { data, error } = await this.db
      .from("calendar_events")
      .select(CAL_COLS)
      .eq("workspace_id", this.workspaceId)
      .lte("start_at", toISO)
      .gte("end_at", fromISO)
      .limit(1000)
    if (error) fail("calendarEventsOverlapping", error)
    return (data ?? []).map(toCalendar)
  }

  async linkCalendarCompany(calendarEventId: string, companyId: string, linkedBy: string) {
    const { error } = await this.db
      .from("calendar_event_companies")
      .upsert(this.ws({ calendar_event_id: calendarEventId, company_id: companyId, linked_by: linkedBy }), {
        onConflict: "calendar_event_id,company_id",
        ignoreDuplicates: true,
      })
    if (error) fail("linkCalendarCompany", error)
  }

  async calendarCompanies(calendarEventId: string) {
    const { data, error } = await this.db
      .from("calendar_event_companies")
      .select("company_id")
      .eq("calendar_event_id", calendarEventId)
    if (error) fail("calendarCompanies", error)
    return (data ?? []).map((r) => r.company_id as string)
  }

  async tappProjectCompany(projectId: string) {
    const { data, error } = await this.db
      .from("tapp_project_companies")
      .select("company_id, ignored")
      .eq("workspace_id", this.workspaceId)
      .eq("project_id", projectId)
      .maybeSingle()
    if (error) fail("tappProjectCompany", error)
    return data ? { companyId: (data.company_id as string) ?? null, ignored: !!data.ignored } : null
  }

  async linkTappProject(projectId: string, projectName: string | null, companyId: string | null, ignored: boolean) {
    const { error } = await this.db.from("tapp_project_companies").upsert(
      this.ws({ project_id: projectId, project_name: projectName, company_id: companyId, ignored, source: "review" }),
      { onConflict: "workspace_id,project_id" }
    )
    if (error) fail("linkTappProject", error)
  }

  async setCalendarTranscription(calendarEventId: string, meetingId: string) {
    const { error } = await this.db
      .from("calendar_events")
      .update({ transcription_meeting_id: meetingId })
      .eq("id", calendarEventId)
    if (error) fail("setCalendarTranscription", error)
  }

  // --- inferências e aplicação ---------------------------------------------

  async companyContext(companyId: string): Promise<CompanyContext | null> {
    const { data: c, error } = await this.db
      .from("companies")
      .select("id, name, champion_name, economic_buyer_name, pain_hypothesis, context_inference_ids, kanban_columns(title)")
      .eq("id", companyId)
      .maybeSingle()
    if (error) fail("companyContext", error)
    if (!c) return null
    const [{ data: signals }, { data: steps }] = await Promise.all([
      this.db.from("company_commitment_signals").select("signal_type").eq("company_id", companyId),
      this.db
        .from("company_next_steps")
        .select("title, due_date")
        .eq("company_id", companyId)
        .eq("status", "pending")
        .limit(200),
    ])
    const col = c.kanban_columns as unknown as { title: string } | { title: string }[] | null
    const stageTitle = Array.isArray(col) ? (col[0]?.title ?? null) : (col?.title ?? null)
    return {
      id: c.id,
      name: c.name,
      stageTitle,
      championName: c.champion_name ?? null,
      economicBuyerName: c.economic_buyer_name ?? null,
      painHypothesis: c.pain_hypothesis ?? null,
      contextInferenceIds: (c.context_inference_ids as Record<string, string>) ?? {},
      signals: (signals ?? []).map((s) => s.signal_type as string),
      openNextSteps: (steps ?? []).map((s) => ({ title: s.title as string, dueDate: (s.due_date as string) ?? null })),
    }
  }

  async insertInference(row: NewInference): Promise<{ row: InferenceRow; created: boolean }> {
    const payload = this.ws({
      company_id: row.companyId,
      field: row.field,
      value: row.value,
      evidence: row.evidence,
      source_activity_id: row.sourceActivityId,
      source_version: row.sourceVersion,
      model: row.model,
      prompt_version: row.promptVersion,
      status: row.status,
      decided_at: row.status === "proposed" ? null : new Date().toISOString(),
    })
    const { data, error } = await this.db.from("inferences").insert(payload).select("id").single()
    if (!error) return { row: { ...row, id: data.id }, created: true }
    if (error.code !== UNIQUE_VIOLATION) fail("insertInference", error)
    const { data: existing, error: readError } = await this.db
      .from("inferences")
      .select("id, status")
      .eq("workspace_id", this.workspaceId)
      .eq("source_activity_id", row.sourceActivityId)
      .eq("source_version", row.sourceVersion)
      .eq("field", row.field)
      .eq("prompt_version", row.promptVersion)
      .single()
    if (readError) fail("insertInference: releitura", readError)
    return { row: { ...row, id: existing.id, status: existing.status }, created: false }
  }

  async hasInference(sourceActivityId: string, sourceVersion: string, field: string) {
    const { data, error } = await this.db
      .from("inferences")
      .select("id")
      .eq("workspace_id", this.workspaceId)
      .eq("source_activity_id", sourceActivityId)
      .eq("source_version", sourceVersion)
      .eq("field", field)
      .limit(1)
    if (error) fail("hasInference", error)
    return (data ?? []).length > 0
  }

  async supersedeOlderInferences(sourceActivityId: string, currentVersion: string) {
    const { data, error } = await this.db
      .from("inferences")
      .update({ status: "superseded", decided_at: new Date().toISOString() })
      .eq("workspace_id", this.workspaceId)
      .eq("source_activity_id", sourceActivityId)
      .neq("source_version", currentVersion)
      .eq("status", "proposed")
      .select("id")
    if (error) fail("supersedeOlderInferences", error)
    return (data ?? []).length
  }

  async setCompanyField(
    companyId: string,
    field: "champion_name" | "economic_buyer_name" | "pain_hypothesis",
    value: string,
    inferenceId: string
  ) {
    const { data } = await this.db.from("companies").select("context_inference_ids").eq("id", companyId).maybeSingle()
    const ids = { ...((data?.context_inference_ids as Record<string, string>) ?? {}), [field]: inferenceId }
    const { error } = await this.db
      .from("companies")
      .update({ [field]: value, context_inference_ids: ids })
      .eq("id", companyId)
      .eq("workspace_id", this.workspaceId)
    if (error) fail("setCompanyField", error)
  }

  async insertSignal(s: NewSignal) {
    const { error } = await this.db.from("company_commitment_signals").insert(
      this.ws({
        user_id: this.authorId,
        company_id: s.companyId,
        signal_type: s.signalType,
        captured_at: s.capturedAt,
        source_activity_id: s.sourceActivityId,
        inference_id: s.inferenceId,
        evidence: s.evidence,
      })
    )
    if (!error) return true
    if (error.code === UNIQUE_VIOLATION) return false
    fail("insertSignal", error)
  }

  async insertNextStep(s: NewNextStep) {
    const { error } = await this.db.from("company_next_steps").insert(
      this.ws({
        user_id: this.authorId,
        company_id: s.companyId,
        title: s.title,
        description: s.description,
        due_date: s.dueDate,
        status: "pending",
        source_ref: s.sourceRef,
        source_activity_id: s.sourceActivityId,
        inference_id: s.inferenceId,
      })
    )
    if (!error) return true
    if (error.code === UNIQUE_VIOLATION) return false
    fail("insertNextStep", error)
  }

  async nextStepsByRefPrefix(companyId: string, prefix: string): Promise<NextStepRow[]> {
    // LIKE: % e _ do prefixo valem literalmente.
    const pattern = `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    const { data, error } = await this.db
      .from("company_next_steps")
      .select("id, company_id, title, description, due_date, status, source_ref, inference_id")
      .eq("workspace_id", this.workspaceId)
      .eq("company_id", companyId)
      .like("source_ref", pattern)
      .limit(500)
    if (error) fail("nextStepsByRefPrefix", error)
    return (data ?? []).map((r) => ({
      id: r.id as string,
      companyId: r.company_id as string,
      title: r.title as string,
      description: (r.description as string) ?? null,
      dueDate: (r.due_date as string) ?? null,
      status: r.status as NextStepRow["status"],
      sourceRef: (r.source_ref as string) ?? null,
      inferenceId: (r.inference_id as string) ?? null,
    }))
  }

  async updateNextStep(id: string, patch: NextStepPatch) {
    const { error } = await this.db
      .from("company_next_steps")
      .update({
        title: patch.title,
        description: patch.description,
        due_date: patch.dueDate,
        source_ref: patch.sourceRef,
        inference_id: patch.inferenceId,
      })
      .eq("id", id)
      .eq("workspace_id", this.workspaceId)
    if (error) fail("updateNextStep", error)
  }

  async setInferenceStatus(id: string, status: InferenceRow["status"]) {
    const { error } = await this.db
      .from("inferences")
      .update({ status, decided_at: new Date().toISOString() })
      .eq("id", id)
      .eq("workspace_id", this.workspaceId)
    if (error) fail("setInferenceStatus", error)
  }

  async promoteSignal(
    companyId: string,
    signalType: string,
    s: { inferenceId: string; sourceActivityId: string; evidence: Evidence[] }
  ) {
    const { data, error } = await this.db
      .from("company_commitment_signals")
      .update({ inference_id: s.inferenceId, source_activity_id: s.sourceActivityId, evidence: s.evidence })
      .eq("workspace_id", this.workspaceId)
      .eq("company_id", companyId)
      .eq("signal_type", signalType)
      .not("inference_id", "is", null)
      .select("id")
    if (error) fail("promoteSignal", error)
    return (data ?? []).length > 0
  }

  // --- cursores -----------------------------------------------------------

  async getCursor(source: string, key = "default") {
    const { data, error } = await this.db
      .from("sync_cursors")
      .select("cursor")
      .eq("workspace_id", this.workspaceId)
      .eq("source", source)
      .eq("key", key)
      .maybeSingle()
    if (error) fail("getCursor", error)
    return (data?.cursor as string) ?? null
  }

  async setCursor(source: string, cursor: string | null, key = "default") {
    const { error } = await this.db
      .from("sync_cursors")
      .upsert(this.ws({ source, key, cursor, updated_at: new Date().toISOString() }), {
        onConflict: "workspace_id,source,key",
      })
    if (error) fail("setCursor", error)
  }
}
