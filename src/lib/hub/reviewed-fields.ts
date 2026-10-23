import { createHash } from "crypto"
import type { Evidence } from "@/lib/events/types"
import { emailDomain, namesCompatible, normalizeEmail, normalizePersonName } from "@/lib/identity/normalize"
import { reviewDedupKey } from "@/lib/identity/resolve"
import type { HubStore, NextStepRow, PersonRow } from "./store"
import { equivalentTitles, titleKey } from "./titles"

// O QUE VOCÊ REVISOU NO TRANSCRIPTIONAPP ANTES DE MANDAR A REUNIÃO.
//
// É a fonte de maior confiança que o hub recebe sobre uma reunião: não é a IA
// lendo a transcrição, é você dizendo "estes são os próximos passos, estes os
// sinais, estas as pessoas". Por isso:
//
//   próximo passo   → entra como tarefa (prazo, responsável na descrição).
//                     Se a IA do hub já criou um passo EQUIVALENTE da mesma
//                     reunião, aquele passo é substituído (mesma linha, valores
//                     seus, inferência dele vira superseded) — nunca uma
//                     segunda linha. Se o hub rodar depois, policy.ts vê os
//                     seus passos da reunião e não cria nada por cima: o
//                     equivalente é pulado, o resto vira proposta.
//   sinal           → como capture_signal (UNIQUE por tipo). Se a IA já o
//                     tinha capturado, o sinal passa a apontar para a sua
//                     confirmação, com a sua evidência.
//   contato         → a escada de identidade, com a empresa já conhecida:
//                     e-mail conhecido → liga; nome único na empresa → liga;
//                     homônimos → fila; ninguém → cria.
//
// Tudo vira linha em `inferences` com model = REVIEWED_MODEL: o "por que o CRM
// acha isso" (explain) mostra que veio de você, de qual reunião.
//
// Idempotência: a chave do passo é tapp:<reunião>:h:<pendência do app ou hash
// do título>, no mesmo UNIQUE(workspace_id, source_ref) do hub. Reenviar a
// mesma reunião não cria nada; reenviar com o prazo editado atualiza o passo
// (se ainda estiver aberto).

export const REVIEWED_MODEL = "humano:transcriptionapp"
export const REVIEWED_PROMPT_VERSION = "tapp-revisado-v1"

export interface ReviewedNextStep {
  title: string
  due_date?: string | null
  assignee?: string | null
  source_action_item_id?: string | null
}

export interface ReviewedSignal {
  type: string
  evidence?: string | null
}

export interface ReviewedContact {
  name: string
  role?: string | null
  email?: string | null
}

export interface ReviewedFieldsInput {
  companyId: string
  /** A atividade da reunião no CRM: origem das inferências e destino dos participantes. */
  activityId: string
  meetingId: string
  /** Quando a reunião aconteceu: data do sinal e do contador. */
  meetingDate: string
  appUrl: string | null
  nextSteps: ReviewedNextStep[]
  signals: ReviewedSignal[]
  contacts: ReviewedContact[]
}

export type NextStepOutcome = "created" | "updated" | "replaced_inferred" | "existing"
export type SignalOutcome = "captured" | "confirmed" | "existing"
export type ContactOutcome = "created" | "linked" | "review" | "internal" | "ignored"

export interface ReviewedFieldsResult {
  next_steps: { title: string; source_action_item_id: string | null; status: NextStepOutcome }[]
  signals: { type: string; status: SignalOutcome }[]
  contacts: { name: string; status: ContactOutcome; person_id: string | null; review_id: string | null }[]
  next_steps_created: number
  signals_captured: number
  contacts_created: number
  contacts_in_review: number
}

/** Prefixo de tudo que a revisão humana gravou para a reunião. policy.ts lê o mesmo. */
export function reviewedStepPrefix(meetingId: string): string {
  return `tapp:${meetingId}:h:`
}

function hash(s: string, n: number): string {
  return createHash("sha256").update(s).digest("hex").slice(0, n)
}

function stepKey(step: ReviewedNextStep): string {
  return step.source_action_item_id ? `item-${step.source_action_item_id}` : `t-${hash(titleKey(step.title), 16)}`
}

function stepDescription(step: ReviewedNextStep): string | null {
  return step.assignee?.trim() ? `Responsável: ${step.assignee.trim()}` : null
}

function evidenceFor(input: ReviewedFieldsInput, quote?: string | null): Evidence[] {
  return [
    {
      kind: "manual",
      ref: input.meetingId,
      quote: quote?.trim() || undefined,
      locator: "revisado no TranscriptionApp",
      url: input.appUrl ?? undefined,
    },
  ]
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return { first: parts[0], last: "—" }
  return { first: parts[0], last: parts.slice(1).join(" ") }
}

export async function applyReviewedFields(
  store: HubStore,
  input: ReviewedFieldsInput,
  internal: Set<string>,
  now: () => Date = () => new Date()
): Promise<ReviewedFieldsResult> {
  const out: ReviewedFieldsResult = {
    next_steps: [],
    signals: [],
    contacts: [],
    next_steps_created: 0,
    signals_captured: 0,
    contacts_created: 0,
    contacts_in_review: 0,
  }
  const base = {
    companyId: input.companyId,
    sourceActivityId: input.activityId,
    model: REVIEWED_MODEL,
    promptVersion: REVIEWED_PROMPT_VERSION,
  }

  // --- próximos passos ------------------------------------------------------
  if (input.nextSteps.length) {
    const company = await store.companyContext(input.companyId)
    const ownPrefix = reviewedStepPrefix(input.meetingId)
    // Tudo que já existe desta reunião nesta empresa: os seus (h:) e os da IA.
    const fromMeeting: NextStepRow[] = await store.nextStepsByRefPrefix(input.companyId, `tapp:${input.meetingId}:`)
    const openElsewhere = new Set(
      (company?.openNextSteps ?? []).map((s) => titleKey(s.title))
    )
    for (const s of fromMeeting) if (s.status === "pending") openElsewhere.delete(titleKey(s.title))

    for (const step of input.nextSteps) {
      const ref = `${ownPrefix}${stepKey(step)}`
      const dueDate = step.due_date ?? null
      const description = stepDescription(step)
      const actionItemId = step.source_action_item_id ?? null
      const report = (status: NextStepOutcome) => {
        out.next_steps.push({ title: step.title, source_action_item_id: actionItemId, status })
        if (status === "created") out.next_steps_created++
      }

      // A versão da origem é o conteúdo: reenviar igual cai no índice; editar
      // o prazo no app é outra versão, com a sua própria evidência.
      const { row: inference } = await store.insertInference({
        ...base,
        field: `next_step:h:${stepKey(step)}`,
        value: { title: step.title, due_date: dueDate, assignee: step.assignee ?? null, source_action_item_id: actionItemId },
        evidence: evidenceFor(input),
        sourceVersion: hash(`${step.title}|${dueDate ?? ""}|${step.assignee ?? ""}`, 12),
        status: "applied",
      })

      const mine = fromMeeting.find((s) => s.sourceRef === ref)
      if (mine) {
        const changed = mine.title !== step.title || mine.dueDate !== dueDate || mine.description !== description
        if (mine.status === "pending" && changed) {
          await store.updateNextStep(mine.id, { title: step.title, description, dueDate, sourceRef: ref, inferenceId: inference.id })
          Object.assign(mine, { title: step.title, description, dueDate, inferenceId: inference.id })
          report("updated")
        } else {
          report("existing")
        }
        continue
      }

      // A IA do hub já tirou um passo equivalente da mesma reunião.
      const inferred = fromMeeting.find(
        (s) => s.sourceRef && !s.sourceRef.startsWith(ownPrefix) && s.inferenceId && equivalentTitles(s.title, step.title)
      )
      if (inferred) {
        if (inferred.status === "pending") {
          await store.updateNextStep(inferred.id, { title: step.title, description, dueDate, sourceRef: ref, inferenceId: inference.id })
          await store.setInferenceStatus(inferred.inferenceId!, "superseded")
          Object.assign(inferred, { title: step.title, description, dueDate, sourceRef: ref, inferenceId: inference.id })
          report("replaced_inferred")
        } else {
          report("existing") // já concluído: não reabre
        }
        continue
      }

      // Mesmo passo aberto de outra origem (à mão, outra reunião): igualdade estrita.
      if (openElsewhere.has(titleKey(step.title))) {
        report("existing")
        continue
      }

      const created = await store.insertNextStep({
        companyId: input.companyId,
        title: step.title,
        description,
        dueDate,
        sourceRef: ref,
        sourceActivityId: input.activityId,
        inferenceId: inference.id,
      })
      if (created) {
        fromMeeting.push({
          id: "",
          companyId: input.companyId,
          title: step.title,
          description,
          dueDate,
          status: "pending",
          sourceRef: ref,
          inferenceId: inference.id,
        })
      }
      report(created ? "created" : "existing")
    }
  }

  // --- sinais ---------------------------------------------------------------
  const nowIso = now().toISOString()
  const occurred = new Date(input.meetingDate).toISOString()
  for (const sig of input.signals) {
    const evidence = evidenceFor(input, sig.evidence)
    const { row: inference, created: newInference } = await store.insertInference({
      ...base,
      field: `signal:${sig.type}`,
      value: { type: sig.type },
      evidence,
      sourceVersion: "",
      status: "applied",
    })
    const inserted = await store.insertSignal({
      companyId: input.companyId,
      signalType: sig.type,
      capturedAt: occurred,
      sourceActivityId: input.activityId,
      inferenceId: inference.id,
      evidence,
    })
    if (inserted) {
      // Sinal é ação do cliente (capture_signal): o contador vai para a data
      // da reunião, com GREATEST, e nunca passa de agora.
      await store.bumpClientEvent(input.companyId, occurred < nowIso ? occurred : nowIso)
      out.signals.push({ type: sig.type, status: "captured" })
      out.signals_captured++
      continue
    }
    const promoted =
      newInference &&
      (await store.promoteSignal(input.companyId, sig.type, {
        inferenceId: inference.id,
        sourceActivityId: input.activityId,
        evidence,
      }))
    out.signals.push({ type: sig.type, status: promoted ? "confirmed" : "existing" })
  }

  // --- contatos -------------------------------------------------------------
  if (input.contacts.length) {
    const company = await store.getCompany(input.companyId)
    for (const c of input.contacts) {
      const r = await resolveContact(store, input, c, company?.name ?? null, internal)
      out.contacts.push({ name: c.name, ...r })
      if (r.status === "created") out.contacts_created++
      if (r.status === "review") out.contacts_in_review++
      if (r.person_id) await store.addParticipants(input.activityId, [{ personId: r.person_id, role: "attendee" }])
    }
  }

  return out
}

async function resolveContact(
  store: HubStore,
  input: ReviewedFieldsInput,
  c: ReviewedContact,
  companyName: string | null,
  internal: Set<string>
): Promise<{ status: ContactOutcome; person_id: string | null; review_id: string | null }> {
  const email = normalizeEmail(c.email)
  if (email && internal.has(emailDomain(email)!)) return { status: "internal", person_id: null, review_id: null }

  // Degrau 1: e-mail conhecido vence o nome.
  if (email) {
    const known = await store.findIdentity("email", email)
    if (known) {
      if (known.ignored || !known.personId) return { status: "ignored", person_id: null, review_id: null }
      return { status: "linked", person_id: known.personId, review_id: null }
    }
  }

  // Empresa já conhecida (é o destino): a pessoa, por nome dentro dela.
  const hits: PersonRow[] = (await store.peopleInCompany(input.companyId)).filter((p) => namesCompatible(c.name, p.fullName))

  if (hits.length === 1) {
    if (email) {
      await store.addIdentity({ personId: hits[0].id, kind: "email", valueNorm: email, valueRaw: c.email, source: "transcription_app", confidence: "weak" })
    }
    return { status: "linked", person_id: hits[0].id, review_id: null }
  }

  if (hits.length > 1) {
    const review = await store.openReview({
      dedupKey: reviewDedupKey("tapp_contact", `${input.companyId}:${email ?? normalizePersonName(c.name) ?? c.name}`),
      companyId: input.companyId,
      reason: "homonimos_na_empresa",
      observed: {
        name: c.name,
        email,
        role: c.role ?? null,
        source: "transcription_app",
        meeting_id: input.meetingId,
        activity_id: input.activityId,
      },
      candidates: hits.map((p) => ({
        personId: p.id,
        label: p.fullName,
        score: 0.5,
        reasons: ["nome compatível na mesma empresa"],
      })),
    })
    return { status: "review", person_id: null, review_id: review.id }
  }

  const { first, last } = splitName(c.name)
  const person = await store.createPerson({
    firstName: first,
    lastName: last,
    companyId: input.companyId,
    currentCompany: companyName,
    currentTitle: c.role?.trim() || null,
    email,
  })
  if (email) {
    await store.addIdentity({ personId: person.id, kind: "email", valueNorm: email, valueRaw: c.email, source: "transcription_app", confidence: "strong" })
  }
  return { status: "created", person_id: person.id, review_id: null }
}
