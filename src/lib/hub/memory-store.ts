import { randomUUID } from "crypto"
import { companyNameKey } from "@/lib/identity/normalize"
import { personDedupKey } from "@/lib/import/dedup-key"
import type {
  CalendarEventRow,
  CompanyContext,
  CompanyRow,
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
  PersonRow,
  ReviewRow,
  UpsertEventResult,
} from "./store"
import type { ParticipantRef } from "@/lib/events/types"

// HubStore em memória para os testes. Cada Map reproduz um índice ÚNICO das
// migrações 019–021 — se o banco recusaria a linha, este store também recusa.
// Não é um mock que devolve o que o teste quer: é o mesmo contrato, para que
// "rodou duas vezes, contou as linhas" prove alguma coisa.

export interface MemoryCompany {
  id: string
  name: string
  stageTitle?: string | null
  championName?: string | null
  economicBuyerName?: string | null
  painHypothesis?: string | null
  contextInferenceIds?: Record<string, string>
  lastClientEventAt?: string | null
}

export class MemoryHubStore implements HubStore {
  readonly workspaceId = "ws-test"

  companies = new Map<string, MemoryCompany>()
  people = new Map<string, PersonRow & { dedupKey: string }>()
  identities = new Map<string, IdentityRow>() // kind|value
  domains = new Map<string, DomainRow>()
  reviews = new Map<string, ReviewRow>() // dedupKey
  events = new Map<string, EventRow & { id: string }>() // idempotencyKey
  participants = new Set<string>() // activity|person|role
  calendar = new Map<string, CalendarEventRow>() // googleEventId
  calendarLinks = new Set<string>() // calendarEventId|companyId
  inferences = new Map<string, InferenceRow>() // activity|version|field|prompt
  signals = new Map<string, NewSignal>() // company|type
  nextSteps = new Map<string, NewNextStep>() // sourceRef
  cursors = new Map<string, string | null>()
  projects = new Map<string, { companyId: string | null; ignored: boolean }>() // projectId

  addCompany(c: MemoryCompany): MemoryCompany {
    this.companies.set(c.id, { contextInferenceIds: {}, ...c })
    return this.companies.get(c.id)!
  }

  addPersonRow(p: Partial<PersonRow> & { firstName: string; lastName: string }): PersonRow {
    const row = {
      id: p.id ?? randomUUID(),
      firstName: p.firstName,
      lastName: p.lastName,
      fullName: `${p.firstName} ${p.lastName}`,
      companyId: p.companyId ?? null,
      email: p.email ?? null,
      dedupKey: personDedupKey({ first_name: p.firstName, last_name: p.lastName, current_company: null }),
    }
    this.people.set(row.id, row)
    return row
  }

  async findIdentity(kind: IdentityKind, valueNorm: string) {
    return this.identities.get(`${kind}|${valueNorm}`) ?? null
  }

  async addIdentity(row: NewIdentity) {
    const key = `${row.kind}|${row.valueNorm}`
    const existing = this.identities.get(key)
    if (existing) return existing
    const created: IdentityRow = {
      id: randomUUID(),
      personId: row.personId,
      ignored: row.ignored ?? false,
      kind: row.kind,
      valueNorm: row.valueNorm,
      confidence: row.confidence,
    }
    this.identities.set(key, created)
    return created
  }

  async findDomain(domain: string) {
    return this.domains.get(domain) ?? null
  }

  async addDomain(row: { domain: string; companyId: string | null; ignored?: boolean; source: string }) {
    const existing = this.domains.get(row.domain)
    if (existing) return existing
    const created = { domain: row.domain, companyId: row.companyId, ignored: row.ignored ?? false }
    this.domains.set(row.domain, created)
    return created
  }

  async getPerson(id: string) {
    return this.people.get(id) ?? null
  }

  async peopleInCompany(companyId: string) {
    return [...this.people.values()].filter((p) => p.companyId === companyId)
  }

  async createPerson(p: NewPerson) {
    const dedupKey = personDedupKey({
      first_name: p.firstName,
      last_name: p.lastName,
      current_company: p.currentCompany,
    })
    const existing = [...this.people.values()].find((x) => x.dedupKey === dedupKey)
    if (existing) return existing
    const row = {
      id: randomUUID(),
      firstName: p.firstName,
      lastName: p.lastName,
      fullName: `${p.firstName} ${p.lastName}`,
      companyId: p.companyId,
      email: p.email,
      dedupKey,
    }
    this.people.set(row.id, row)
    return row
  }

  async getCompany(id: string): Promise<CompanyRow | null> {
    const c = this.companies.get(id)
    return c ? { id: c.id, name: c.name, nameKey: companyNameKey(c.name) } : null
  }

  async companiesByNameKey(key: string) {
    return [...this.companies.values()]
      .filter((c) => companyNameKey(c.name) === key)
      .map((c) => ({ id: c.id, name: c.name, nameKey: key }))
  }

  async openReview(r: NewReview) {
    const existing = this.reviews.get(r.dedupKey)
    if (existing) return existing
    const row: ReviewRow = { ...r, id: randomUUID(), status: "open" }
    this.reviews.set(r.dedupKey, row)
    return row
  }

  async upsertEvent(row: EventRow): Promise<UpsertEventResult> {
    const existing = this.events.get(row.idempotencyKey)
    if (!existing) {
      const id = randomUUID()
      this.events.set(row.idempotencyKey, { ...row, id })
      return { id, created: true, versionChanged: false }
    }
    if ((existing.sourceVersion ?? null) !== (row.sourceVersion ?? null)) {
      this.events.set(row.idempotencyKey, { ...row, id: existing.id })
      return { id: existing.id, created: false, versionChanged: true }
    }
    if (existing.engagementRule !== row.engagementRule) {
      // Regra de engajamento mudou para o mesmo fato: reclassifica, com a nova evidência.
      this.events.set(row.idempotencyKey, {
        ...existing,
        clientEngaged: row.clientEngaged,
        engagementRule: row.engagementRule,
        evidence: row.evidence,
      })
    }
    return { id: existing.id, created: false, versionChanged: false }
  }

  async addParticipants(activityId: string, refs: ParticipantRef[]) {
    for (const r of refs) this.participants.add(`${activityId}|${r.personId}|${r.role}`)
  }

  async tappProjectCompany(projectId: string) {
    return this.projects.get(projectId) ?? null
  }

  async linkTappProject(projectId: string, _name: string | null, companyId: string | null, ignored: boolean) {
    this.projects.set(projectId, { companyId, ignored })
  }

  async bumpClientEvent(companyId: string, occurredAt: string) {
    const c = this.companies.get(companyId)
    if (!c) return
    if (!c.lastClientEventAt || c.lastClientEventAt < occurredAt) c.lastClientEventAt = occurredAt
  }

  async setEventSummary(activityId: string, summary: unknown) {
    for (const e of this.events.values()) if (e.id === activityId) e.summary = summary
  }

  async upsertCalendarEvent(ev: NewCalendarEvent) {
    const existing = this.calendar.get(ev.googleEventId)
    const row: CalendarEventRow = {
      ...ev,
      id: existing?.id ?? randomUUID(),
      transcriptionMeetingId: existing?.transcriptionMeetingId ?? null,
    }
    this.calendar.set(ev.googleEventId, row)
    return row
  }

  async getCalendarEventByGoogleId(googleEventId: string) {
    return this.calendar.get(googleEventId) ?? null
  }

  async calendarEventsOverlapping(fromISO: string, toISO: string) {
    return [...this.calendar.values()].filter(
      (e) => e.startAt && e.endAt && e.startAt <= toISO && e.endAt >= fromISO
    )
  }

  async linkCalendarCompany(calendarEventId: string, companyId: string) {
    this.calendarLinks.add(`${calendarEventId}|${companyId}`)
  }

  async calendarCompanies(calendarEventId: string) {
    return [...this.calendarLinks]
      .filter((k) => k.startsWith(`${calendarEventId}|`))
      .map((k) => k.split("|")[1])
  }

  async setCalendarTranscription(calendarEventId: string, meetingId: string) {
    for (const e of this.calendar.values()) if (e.id === calendarEventId) e.transcriptionMeetingId = meetingId
  }

  async companyContext(companyId: string): Promise<CompanyContext | null> {
    const c = this.companies.get(companyId)
    if (!c) return null
    return {
      id: c.id,
      name: c.name,
      stageTitle: c.stageTitle ?? null,
      championName: c.championName ?? null,
      economicBuyerName: c.economicBuyerName ?? null,
      painHypothesis: c.painHypothesis ?? null,
      contextInferenceIds: c.contextInferenceIds ?? {},
      signals: [...this.signals.values()].filter((s) => s.companyId === companyId).map((s) => s.signalType),
      openNextSteps: [...this.nextSteps.values()]
        .filter((s) => s.companyId === companyId)
        .map((s) => ({ title: s.title, dueDate: s.dueDate })),
    }
  }

  async insertInference(row: NewInference) {
    const key = `${row.sourceActivityId}|${row.sourceVersion}|${row.field}|${row.promptVersion}`
    const existing = this.inferences.get(key)
    if (existing) return { row: existing, created: false }
    const created = { ...row, id: randomUUID() }
    this.inferences.set(key, created)
    return { row: created, created: true }
  }

  async hasInference(sourceActivityId: string, sourceVersion: string, field: string) {
    return [...this.inferences.values()].some(
      (i) => i.sourceActivityId === sourceActivityId && i.sourceVersion === sourceVersion && i.field === field
    )
  }

  async supersedeOlderInferences(sourceActivityId: string, currentVersion: string) {
    let n = 0
    for (const inf of this.inferences.values()) {
      if (inf.sourceActivityId === sourceActivityId && inf.sourceVersion !== currentVersion && inf.status === "proposed") {
        inf.status = "superseded"
        n++
      }
    }
    return n
  }

  async setCompanyField(
    companyId: string,
    field: "champion_name" | "economic_buyer_name" | "pain_hypothesis",
    value: string,
    inferenceId: string
  ) {
    const c = this.companies.get(companyId)
    if (!c) return
    if (field === "champion_name") c.championName = value
    if (field === "economic_buyer_name") c.economicBuyerName = value
    if (field === "pain_hypothesis") c.painHypothesis = value
    c.contextInferenceIds = { ...(c.contextInferenceIds ?? {}), [field]: inferenceId }
  }

  async insertSignal(s: NewSignal) {
    const key = `${s.companyId}|${s.signalType}`
    if (this.signals.has(key)) return false
    this.signals.set(key, s)
    return true
  }

  async insertNextStep(s: NewNextStep) {
    if (this.nextSteps.has(s.sourceRef)) return false
    this.nextSteps.set(s.sourceRef, s)
    return true
  }

  async getCursor(source: string, key = "default") {
    return this.cursors.get(`${source}|${key}`) ?? null
  }

  async setCursor(source: string, cursor: string | null, key = "default") {
    this.cursors.set(`${source}|${key}`, cursor)
  }
}
