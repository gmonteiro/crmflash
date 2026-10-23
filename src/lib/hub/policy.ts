import { createHash } from "crypto"
import type { Evidence } from "@/lib/events/types"
import { normalizePersonName } from "@/lib/identity/normalize"
import { EXTRACTION_PROMPT_VERSION, type Extraction, type ExtractionEvidence } from "./extraction"
import type { CompanyContext, HubStore } from "./store"

// O QUE A IA PODE ESCREVER SOZINHA (tabela 6.2 do design).
//
//   campo vazio no CRM      → aplica, com a evidência
//   campo já preenchido     → só PROPÕE (vira pergunta no copiloto); nunca
//                             sobrescreve o que você escreveu
//   sinal                   → aplica se ainda não existe (UNIQUE por tipo)
//   próximo passo           → cria, com prazo e dono; mesmo título aberto não duplica
//   estágio                 → NUNCA aplica; sempre proposta
//
// Toda conclusão vira uma linha em `inferences`, aplicada ou não. É de lá que
// sai o "por que o CRM acha isso" (tool explain).

export interface ApplyMeta {
  sourceActivityId: string
  sourceVersion: string
  meetingId: string
  meetingDate: string
  appUrl: string | null
  model: string
}

export interface ApplyStats {
  applied: string[]
  proposed: string[]
  skipped: string[]
}

const CONTEXT_FIELDS = {
  champion: "champion_name",
  economic_buyer: "economic_buyer_name",
  pain_hypothesis: "pain_hypothesis",
} as const

function toEvidence(evs: ExtractionEvidence[], meta: ApplyMeta): Evidence[] {
  return evs.map((e) => ({
    kind: "transcript",
    ref: meta.meetingId,
    quote: e.quote,
    locator: `trecho ${e.segment} · ${e.speaker}`,
    url: meta.appUrl ?? undefined,
  }))
}

function sameText(a: string | null, b: string | null): boolean {
  return (normalizePersonName(a) ?? "") === (normalizePersonName(b) ?? "")
}

function titleKey(title: string): string {
  return normalizePersonName(title) ?? title.toLowerCase()
}

export async function applyExtraction(
  store: HubStore,
  company: CompanyContext,
  ex: Extraction,
  meta: ApplyMeta
): Promise<ApplyStats> {
  const stats: ApplyStats = { applied: [], proposed: [], skipped: [] }
  const base = {
    companyId: company.id,
    sourceActivityId: meta.sourceActivityId,
    sourceVersion: meta.sourceVersion,
    model: meta.model,
    promptVersion: EXTRACTION_PROMPT_VERSION,
  }

  await store.insertInference({ ...base, field: "summary", value: { text: ex.summary }, evidence: [], status: "applied" })

  // --- champion, comprador econômico, dor ---
  for (const key of ["champion", "economic_buyer", "pain_hypothesis"] as const) {
    const item = ex[key]
    if (!item) continue
    const value = "name" in item ? item.name : item.text
    const column = CONTEXT_FIELDS[key]
    const current =
      key === "champion" ? company.championName : key === "economic_buyer" ? company.economicBuyerName : company.painHypothesis

    if (current && sameText(current, value)) {
      stats.skipped.push(key)
      continue
    }
    const status = current ? "proposed" : "applied"
    const { row, created } = await store.insertInference({
      ...base,
      field: key,
      value: { value, previous: current ?? null, rationale: "rationale" in item ? item.rationale : null },
      evidence: toEvidence(item.evidence, meta),
      status,
    })
    if (!created) {
      stats.skipped.push(key)
      continue
    }
    if (status === "applied") {
      await store.setCompanyField(company.id, column, value, row.id)
      stats.applied.push(key)
    } else {
      stats.proposed.push(key)
    }
  }

  // --- sinais ---
  for (const s of ex.signals) {
    if (company.signals.includes(s.type)) {
      stats.skipped.push(`signal:${s.type}`)
      continue
    }
    const evidence = toEvidence(s.evidence, meta)
    const { row, created } = await store.insertInference({
      ...base,
      field: `signal:${s.type}`,
      value: { type: s.type },
      evidence,
      status: "applied",
    })
    if (!created) continue
    const inserted = await store.insertSignal({
      companyId: company.id,
      signalType: s.type,
      capturedAt: meta.meetingDate,
      sourceActivityId: meta.sourceActivityId,
      inferenceId: row.id,
      evidence,
    })
    stats[inserted ? "applied" : "skipped"].push(`signal:${s.type}`)
  }

  // --- próximos passos ---
  const openTitles = new Set(company.openNextSteps.map((s) => titleKey(s.title)))
  for (const [i, step] of ex.next_steps.entries()) {
    const tk = titleKey(step.title)
    if (openTitles.has(tk)) {
      stats.skipped.push(`next_step:${i}`)
      continue
    }
    const { row } = await store.insertInference({
      ...base,
      field: `next_step:${createHash("sha256").update(tk).digest("hex").slice(0, 12)}`,
      value: step,
      evidence: toEvidence(step.evidence, meta),
      status: "applied",
    })
    // source_ref pela reunião + título: a mesma transcrição reprocessada (ou
    // uma versão nova dela) não cria o mesmo passo de novo.
    const sourceRef = `tapp:${meta.meetingId}:${createHash("sha256").update(tk).digest("hex").slice(0, 16)}`
    const owner = step.owner === "client" ? "Cliente" : "Lumeis"
    const created = await store.insertNextStep({
      companyId: company.id,
      title: step.title,
      description: [`Responsável: ${step.assignee ?? owner}`, step.due_basis === "inferred" ? "Prazo inferido da conversa" : null]
        .filter(Boolean)
        .join(" · "),
      dueDate: step.due_date,
      sourceRef,
      sourceActivityId: meta.sourceActivityId,
      inferenceId: row.id,
    })
    if (created) openTitles.add(tk)
    stats[created ? "applied" : "skipped"].push(`next_step:${i}`)
  }

  // --- estágio: sempre proposta ---
  if (ex.stage_suggestion && ex.stage_suggestion.target_stage !== company.stageTitle) {
    const { created } = await store.insertInference({
      ...base,
      field: "stage_suggestion",
      value: { target_stage: ex.stage_suggestion.target_stage, from: company.stageTitle, rationale: ex.stage_suggestion.rationale },
      evidence: toEvidence(ex.stage_suggestion.evidence, meta),
      status: "proposed",
    })
    if (created) stats.proposed.push("stage_suggestion")
  }

  return stats
}
