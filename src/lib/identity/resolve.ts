import { createHash } from "crypto"
import type { HubStore, PersonRow, ReviewCandidate } from "@/lib/hub/store"
import {
  companyNameKey,
  domainLabel,
  emailDomain,
  isFreeMailDomain,
  namesCompatible,
  normalizeEmail,
  personNameTokens,
  splitNameAndEmail,
} from "./normalize"

// A ESCADA DE MATCH (seção 5.3 do design).
//
// Regra de ouro: nada se funde sem chave forte. Errar para o lado de perguntar
// custa um clique na fila; errar para o lado de fundir mistura a timeline de
// duas pessoas, e ninguém percebe.
//
//   1. e-mail já conhecido            → liga (strong)
//   2. domínio já ligado a empresa    → empresa certa; pessoa por nome dentro dela
//                                       (1 → liga; 0 → cria; ≥2 → fila)
//   3. domínio novo, não genérico     → SEMPRE fila (sugere empresa pelo rótulo)
//   4. e-mail genérico desconhecido   → SEMPRE fila
//   5. falante da transcrição         → mundo fechado: só os participantes daquela reunião
//   6. só nome, sem chave forte       → nunca funde

export interface Observation {
  email: string | null
  name: string | null
  /** De onde veio: "calendar", "gmail"... vai para identities.source e para a fila. */
  source: string
  /** Referência da origem (event id, message id), para a revisão mostrar onde apareceu. */
  sourceRef: string
  /** Empresas já ligadas ao mesmo contexto (outros participantes do convite). */
  contextCompanyIds?: string[]
}

export type Resolution =
  | { status: "internal" }
  | { status: "ignored" }
  | { status: "linked"; personId: string; companyId: string | null; via: string; created: boolean }
  | { status: "review"; reviewId: string; reason: string }
  | { status: "unresolvable"; reason: string }

export function reviewDedupKey(kind: string, value: string): string {
  return createHash("sha256").update(`${kind}:${value}`).digest("hex").slice(0, 32)
}

/** "joao.silva" → ["João"? não: "Joao", "Silva"]. Só quando não há nome nenhum. */
function nameFromLocalPart(email: string): { first: string; last: string } {
  const local = email.slice(0, email.indexOf("@")).replace(/[0-9]+/g, "")
  const parts = local.split(/[._-]+/).filter(Boolean)
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  if (parts.length >= 2) return { first: cap(parts[0]), last: cap(parts[parts.length - 1]) }
  return { first: cap(parts[0] ?? local), last: "—" }
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return { first: parts[0], last: "—" }
  return { first: parts[0], last: parts.slice(1).join(" ") }
}

export async function resolveObservation(
  store: HubStore,
  obs: Observation,
  internal: Set<string>
): Promise<Resolution> {
  const split = splitNameAndEmail(obs.name)
  const email = normalizeEmail(obs.email) ?? split.email
  const displayName = split.name

  if (!email) {
    // Sem chave forte não há o que fazer fora de um mundo fechado (degrau 6).
    return { status: "unresolvable", reason: "sem_email" }
  }

  const domain = emailDomain(email)!
  if (internal.has(domain)) return { status: "internal" }

  // Degrau 1: identidade conhecida.
  const known = await store.findIdentity("email", email)
  if (known) {
    if (known.ignored || !known.personId) return { status: "ignored" }
    const person = await store.getPerson(known.personId)
    return {
      status: "linked",
      personId: known.personId,
      companyId: person?.companyId ?? null,
      via: "identity",
      created: false,
    }
  }

  const observed = { email, name: displayName, source: obs.source, ref: obs.sourceRef, domain }

  // Degrau 4: e-mail genérico desconhecido. Candidatos só por nome, dentro das
  // empresas do mesmo contexto — mas quem decide é você.
  if (isFreeMailDomain(domain)) {
    const candidates = await nameCandidates(store, displayName, obs.contextCompanyIds ?? [])
    const review = await store.openReview({
      dedupKey: reviewDedupKey("email", email),
      companyId: obs.contextCompanyIds?.[0] ?? null,
      reason: "email_generico_desconhecido",
      observed,
      candidates,
    })
    return { status: "review", reviewId: review.id, reason: review.reason }
  }

  const dom = await store.findDomain(domain)
  if (dom?.ignored) return { status: "ignored" }

  // Degrau 3: domínio que ninguém ligou ainda. Nunca grava sozinho: um domínio
  // errado contamina todos os e-mails futuros daquele domínio.
  if (!dom || !dom.companyId) {
    const label = domainLabel(domain)
    const byKey = await store.companiesByNameKey(companyNameKey(label) ?? label)
    const candidates: ReviewCandidate[] = byKey.map((c) => ({
      companyId: c.id,
      label: c.name,
      score: 0.8,
      reasons: [`nome da empresa bate com o domínio ${domain}`],
    }))
    const review = await store.openReview({
      dedupKey: reviewDedupKey("domain", domain),
      companyId: null,
      reason: "dominio_desconhecido",
      observed,
      candidates,
    })
    return { status: "review", reviewId: review.id, reason: review.reason }
  }

  // Degrau 2: empresa certa pelo domínio; a pessoa, por nome dentro dela.
  const companyId = dom.companyId
  const inCompany = await store.peopleInCompany(companyId)
  const nameForMatch = displayName ?? null
  const matches = nameForMatch ? inCompany.filter((p) => namesCompatible(nameForMatch, p.fullName)) : []

  if (matches.length === 1) {
    await store.addIdentity({
      personId: matches[0].id,
      kind: "email",
      valueNorm: email,
      valueRaw: obs.email,
      source: obs.source,
      confidence: "weak",
    })
    return { status: "linked", personId: matches[0].id, companyId, via: "domain_name_match", created: false }
  }

  if (matches.length > 1) {
    const review = await store.openReview({
      dedupKey: reviewDedupKey("email", email),
      companyId,
      reason: "homonimos_na_empresa",
      observed,
      candidates: matches.map((p) => ({
        personId: p.id,
        label: p.fullName,
        score: 0.5,
        reasons: ["mesmo primeiro nome na mesma empresa"],
      })),
    })
    return { status: "review", reviewId: review.id, reason: review.reason }
  }

  // Ninguém com esse nome na empresa: cria a pessoa, ligada pelo e-mail.
  const company = await store.getCompany(companyId)
  const { first, last } = displayName ? splitName(displayName) : nameFromLocalPart(email)
  const person = await store.createPerson({
    firstName: first,
    lastName: last,
    companyId,
    currentCompany: company?.name ?? null,
    email,
  })
  const identity = await store.addIdentity({
    personId: person.id,
    kind: "email",
    valueNorm: email,
    valueRaw: obs.email,
    source: obs.source,
    confidence: "weak",
  })
  return {
    status: "linked",
    personId: identity.personId ?? person.id,
    companyId,
    via: "domain_new_person",
    created: true,
  }
}

async function nameCandidates(
  store: HubStore,
  name: string | null,
  companyIds: string[]
): Promise<ReviewCandidate[]> {
  if (!name) return []
  const out: ReviewCandidate[] = []
  for (const cid of companyIds) {
    for (const p of await store.peopleInCompany(cid)) {
      if (namesCompatible(name, p.fullName)) {
        out.push({ personId: p.id, label: p.fullName, score: 0.4, reasons: ["nome compatível, mesma reunião"] })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Degrau 5: falantes da transcrição, em MUNDO FECHADO.
//
// "João" na transcrição só é comparado com quem estava naquela reunião. No CRM
// inteiro há dezenas de Joões; na reunião, quase sempre um.
// ---------------------------------------------------------------------------

export interface Speaker {
  id: string
  name: string | null
  email: string | null
}

export interface MeetingParticipant {
  personId: string | null
  name: string | null
  email: string | null
  internal: boolean
}

export type SpeakerMatch =
  | { speakerId: string; status: "person"; personId: string; via: "email" | "name" }
  | { speakerId: string; status: "internal" }
  | { speakerId: string; status: "ambiguous"; candidates: string[] }
  | { speakerId: string; status: "unknown" }

const GENERIC_SPEAKER = /^(pessoa|speaker|falante|participante)\s*\d+$/i

export function matchSpeakers(speakers: Speaker[], participants: MeetingParticipant[]): SpeakerMatch[] {
  return speakers.map((s) => {
    const email = normalizeEmail(s.email)
    if (email) {
      const p = participants.find((x) => normalizeEmail(x.email) === email)
      if (p?.internal) return { speakerId: s.id, status: "internal" as const }
      if (p?.personId) return { speakerId: s.id, status: "person" as const, personId: p.personId, via: "email" as const }
    }

    if (!s.name || GENERIC_SPEAKER.test(s.name.trim()) || personNameTokens(s.name).length === 0) {
      return { speakerId: s.id, status: "unknown" as const }
    }

    const hits = participants.filter((p) => namesCompatible(s.name, p.name ?? emailLocalAsName(p.email)))
    if (hits.length === 1) {
      const p = hits[0]
      if (p.internal) return { speakerId: s.id, status: "internal" as const }
      if (p.personId) return { speakerId: s.id, status: "person" as const, personId: p.personId, via: "name" as const }
      return { speakerId: s.id, status: "unknown" as const }
    }
    if (hits.length > 1) {
      return {
        speakerId: s.id,
        status: "ambiguous" as const,
        candidates: hits.map((h) => h.personId ?? h.email ?? h.name ?? "?"),
      }
    }
    return { speakerId: s.id, status: "unknown" as const }
  })
}

function emailLocalAsName(email: string | null): string | null {
  if (!email) return null
  const n = nameFromLocalPart(email)
  return `${n.first} ${n.last === "—" ? "" : n.last}`.trim()
}

export type { PersonRow }
