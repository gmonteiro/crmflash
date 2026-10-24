import { createHash } from "node:crypto"
import Anthropic from "@anthropic-ai/sdk"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import { z } from "zod"
import { STAGE_EXIT_CRITERIA } from "@/lib/constants"
import type { Evidence } from "@/lib/events/types"
import { EXTRACTION_MODEL } from "./extraction"
import type { ConversationItem } from "./open-items"
import type { HubStore } from "./store"

// Revisão diária das contas ativas (spec, seção 8).
//
//   1. determinístico: nenhum evento novo desde a última revisão → estagnação,
//      sem gastar modelo;
//   2. com eventos novos: Claude classifica avanço / estagnação / risco e
//      cita os ids dos eventos. Ids que não estão na lista são descartados no
//      servidor. Sugestão de estágio e próximo passo entram como PROPOSTA
//      (inferences), e a fila do copiloto pergunta. Nunca move estágio, nunca
//      escreve para o cliente;
//   3. daily_reviews é único por (empresa, dia): rodar de novo no mesmo dia
//      não refaz nem gasta modelo.

export const DAILY_REVIEW_PROMPT_VERSION = "revisao-diaria-v1"
export const ACTIVE_STAGES = ["Contato", "Diagnóstico", "Dor validada", "Solução desenhada", "Prova", "Aprovação"]
/** Primeira revisão de uma conta: olha a última semana. */
export const FIRST_REVIEW_LOOKBACK_DAYS = 7

export type Verdict = "avanco" | "estagnacao" | "risco"

export interface ReviewCompany {
  id: string
  name: string
  stageTitle: string
  daysInStage: number | null
  lastClientEventAt: string | null
  championName: string | null
  painHypothesis: string | null
  signals: string[]
  openNextSteps: { title: string; dueDate: string | null }[]
}

export interface ReviewEvent {
  /** id em activities (hub) ou `manual:<id>` (company_activities, o log_activity). */
  id: string
  kind: string
  title: string
  description: string | null
  occurredAt: string
  clientEngaged: boolean | null
}

export interface DailyReviewRow {
  companyId: string
  reviewDate: string // YYYY-MM-DD
  verdict: Verdict
  rationale: string
  evidenceActivityIds: string[]
  model: string
  promptVersion: string
  stageSuggestion: string | null
  nextStep: string | null
}

export interface DailyReviewStore extends Pick<HubStore, "insertInference" | "supersedePendingField"> {
  activeCompanies(stageTitles: string[], onlyCompanyId?: string): Promise<ReviewCompany[]>
  /** Eventos que ENTRARAM no CRM depois de `sinceISO` (created_at): é informação nova. */
  eventsSince(companyId: string, sinceISO: string): Promise<ReviewEvent[]>
  /** Quando foi feita a última revisão desta conta (created_at), ou null. */
  lastReviewAt(companyId: string): Promise<string | null>
  dailyReview(companyId: string, reviewDate: string): Promise<DailyReviewRow | null>
  /** UNIQUE(company_id, review_date): false se já existia. */
  insertDailyReview(row: DailyReviewRow): Promise<boolean>
  reviewsOn(reviewDate: string): Promise<(DailyReviewRow & { companyName: string })[]>
  openIdentityReviews(): Promise<number>
}

// --- o modelo ---------------------------------------------------------------

export const DailyVerdictZ = z.object({
  verdict: z.enum(["avanco", "estagnacao", "risco"]),
  rationale: z.string().describe("Uma ou duas frases, em português, citando o que aconteceu."),
  evidence_ids: z.array(z.string()).describe("Ids dos eventos (da lista) que sustentam o veredito."),
  stage_suggestion: z
    .object({ target_stage: z.string(), rationale: z.string() })
    .nullable()
    .describe("Só se o critério de saída do estágio atual foi cumprido pelos eventos. Senão null."),
  next_step: z
    .object({ title: z.string(), due_date: z.string().nullable(), rationale: z.string() })
    .nullable()
    .describe("Só se nenhum próximo passo aberto cobre o que a conta precisa agora. Senão null."),
})
export type DailyVerdict = z.infer<typeof DailyVerdictZ>

export interface Reviewer {
  review(input: { company: ReviewCompany; events: ReviewEvent[]; today: string }): Promise<DailyVerdict>
}

export function buildReviewPrompt(input: { company: ReviewCompany; events: ReviewEvent[]; today: string }) {
  const c = input.company
  const criteria = STAGE_EXIT_CRITERIA as Record<string, string | undefined>
  const system = [
    "Você revisa, uma vez por dia, uma conta do funil comercial B2B da Lumeis (consultoria de dados e IA).",
    "Classifique a conta pelo que os EVENTOS NOVOS mostram:",
    "- avanco: o cliente agiu e a conta andou (respondeu, marcou, mandou dado, envolveu outra pessoa, pediu preço);",
    "- risco: o cliente adiou ou cancelou, sumiu depois de pedir preço, o champion saiu, apareceu concorrente, ou uma pergunta direta nossa está sem resposta há 7 dias ou mais;",
    "- estagnacao: houve movimento, mas só nosso, ou nada que mude a conta.",
    "Cite em evidence_ids só ids da lista de eventos. Não invente fatos fora dos eventos e do contexto.",
    "stage_suggestion só se o critério de saída do estágio atual foi cumprido; próximo passo só se faltar um.",
    "Responda em português do Brasil.",
  ].join("\n")
  const user = [
    `Hoje: ${input.today}`,
    `Conta: ${c.name}`,
    `Estágio: ${c.stageTitle}${c.daysInStage != null ? ` (há ${c.daysInStage} dias)` : ""}`,
    `Critério de saída do estágio: ${criteria[c.stageTitle] ?? "—"}`,
    `Estágios, em ordem: ${ACTIVE_STAGES.join(" → ")}`,
    `Último contato do cliente: ${c.lastClientEventAt ?? "nunca registrado"}`,
    `Champion: ${c.championName ?? "—"} · Dor: ${c.painHypothesis ?? "—"}`,
    `Sinais: ${c.signals.join(", ") || "—"}`,
    `Próximos passos abertos: ${c.openNextSteps.map((s) => `${s.title}${s.dueDate ? ` (até ${s.dueDate})` : ""}`).join("; ") || "nenhum"}`,
    "",
    "Eventos novos (id | quando | tipo | cliente agiu? | título | trecho):",
    ...input.events.map(
      (e) =>
        `${e.id} | ${e.occurredAt.slice(0, 16)} | ${e.kind} | ${e.clientEngaged ? "sim" : "não"} | ${e.title} | ${(e.description ?? "").slice(0, 300)}`
    ),
  ].join("\n")
  return { system, user }
}

export class ClaudeReviewer implements Reviewer {
  constructor(private readonly client = new Anthropic()) {}
  async review(input: { company: ReviewCompany; events: ReviewEvent[]; today: string }): Promise<DailyVerdict> {
    const { system, user } = buildReviewPrompt(input)
    const message = await this.client.messages
      .stream({
        model: EXTRACTION_MODEL,
        max_tokens: 4000,
        system,
        messages: [{ role: "user", content: user }],
        output_config: { effort: "low", format: zodOutputFormat(DailyVerdictZ) },
      })
      .finalMessage()
    if (message.stop_reason === "refusal") throw new Error("Revisão recusada pelo modelo")
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
    return DailyVerdictZ.parse(JSON.parse(text))
  }
}

// --- a rodada ---------------------------------------------------------------

export interface CompanyReviewResult {
  companyId: string
  name: string
  verdict: Verdict
  ai: boolean
  skipped?: "ja_revisada_hoje"
  proposed: string[]
}

const DAY = 24 * 60 * 60 * 1000

export async function reviewCompany(
  store: DailyReviewStore,
  reviewer: Reviewer,
  c: ReviewCompany,
  today: string,
  now: number
): Promise<CompanyReviewResult> {
  const existing = await store.dailyReview(c.id, today)
  if (existing) return { companyId: c.id, name: c.name, verdict: existing.verdict, ai: false, skipped: "ja_revisada_hoje", proposed: [] }

  const since = (await store.lastReviewAt(c.id)) ?? new Date(now - FIRST_REVIEW_LOOKBACK_DAYS * DAY).toISOString()
  const events = await store.eventsSince(c.id, since)

  if (events.length === 0) {
    const days = c.lastClientEventAt ? Math.floor((now - Date.parse(c.lastClientEventAt)) / DAY) : null
    await store.insertDailyReview({
      companyId: c.id,
      reviewDate: today,
      verdict: "estagnacao",
      rationale: `Nenhum evento novo desde ${since.slice(0, 10)}. ${days != null ? `Último contato do cliente há ${days} dias.` : "Nenhum contato do cliente registrado."}`,
      evidenceActivityIds: [],
      model: "deterministico",
      promptVersion: DAILY_REVIEW_PROMPT_VERSION,
      stageSuggestion: null,
      nextStep: null,
    })
    return { companyId: c.id, name: c.name, verdict: "estagnacao", ai: false, proposed: [] }
  }

  const out = await reviewer.review({ company: c, events, today })
  const known = new Map(events.map((e) => [e.id, e]))
  const evidenceIds = [...new Set(out.evidence_ids)].filter((id) => known.has(id))
  // Proposta precisa de um evento do hub como origem (inferences.source_activity_id).
  const hubEvidence = evidenceIds.filter((id) => !id.startsWith("manual:"))
  const evidence: Evidence[] = evidenceIds.map((id) => ({
    kind: "manual",
    ref: id,
    quote: known.get(id)!.title,
    locator: `revisão diária ${today}`,
  }))
  const base = {
    companyId: c.id,
    sourceActivityId: hubEvidence[0],
    sourceVersion: `daily:${today}`,
    model: EXTRACTION_MODEL,
    promptVersion: DAILY_REVIEW_PROMPT_VERSION,
  }
  const proposed: string[] = []

  const stage = out.stage_suggestion
  const stageOk = !!stage && ACTIVE_STAGES.concat("Ganho").includes(stage.target_stage) && stage.target_stage !== c.stageTitle
  if (stageOk && hubEvidence.length) {
    const { row, created } = await store.insertInference({
      ...base,
      field: "stage_suggestion",
      value: { target_stage: stage!.target_stage, from: c.stageTitle, rationale: stage!.rationale },
      evidence,
      status: "proposed",
    })
    if (created) {
      await store.supersedePendingField(c.id, "stage_suggestion", row.id)
      proposed.push("stage_suggestion")
    }
  }

  const step = out.next_step
  if (step && hubEvidence.length) {
    const due = step.due_date && /^\d{4}-\d{2}-\d{2}$/.test(step.due_date) ? step.due_date : null
    const key = createHash("sha256").update(step.title.trim().toLowerCase()).digest("hex").slice(0, 12)
    const { created } = await store.insertInference({
      ...base,
      field: `next_step:${key}`,
      value: { title: step.title, due_date: due, owner: "lumeis", assignee: null, due_basis: due ? "inferred" : "none", rationale: step.rationale },
      evidence,
      status: "proposed",
    })
    if (created) proposed.push("next_step")
  }

  await store.insertDailyReview({
    companyId: c.id,
    reviewDate: today,
    verdict: out.verdict,
    rationale: out.rationale,
    evidenceActivityIds: evidenceIds,
    model: EXTRACTION_MODEL,
    promptVersion: DAILY_REVIEW_PROMPT_VERSION,
    stageSuggestion: stageOk ? stage!.target_stage : null,
    nextStep: step?.title ?? null,
  })
  return { companyId: c.id, name: c.name, verdict: out.verdict, ai: true, proposed }
}

/** Data de hoje em Brasília (o resumo é do dia dele, não do UTC). */
export function todayInSaoPaulo(now = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(now))
}

export async function runDailyReview(
  store: DailyReviewStore,
  reviewer: Reviewer,
  opts: { now?: number; companyId?: string; budgetMs?: number } = {}
): Promise<{ today: string; results: CompanyReviewResult[]; failed: { companyId: string; error: string }[]; complete: boolean }> {
  const now = opts.now ?? Date.now()
  const started = Date.now()
  const today = todayInSaoPaulo(now)
  const companies = await store.activeCompanies(ACTIVE_STAGES, opts.companyId)
  const results: CompanyReviewResult[] = []
  const failed: { companyId: string; error: string }[] = []
  let complete = true
  for (const c of companies) {
    if (Date.now() - started > (opts.budgetMs ?? 230_000)) {
      complete = false
      break
    }
    try {
      results.push(await reviewCompany(store, reviewer, c, today, now))
    } catch (e) {
      failed.push({ companyId: c.id, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return { today, results, failed, complete }
}

// --- o resumo por e-mail ----------------------------------------------------

export interface Digest {
  subject: string
  html: string
  counts: { risco: number; sugestoes: number; aguardandoVoce: number; aguardandoCliente: number; decisoes: number; avanco: number }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!)

/**
 * Ordem: alertas do sistema, aguardando você, aguardando o cliente, riscos,
 * sugestões de estágio, decisões abertas, avanços.
 * Sem nada disso, null: não manda e-mail.
 */
/** Sem batimento do coletor de WhatsApp há mais disto, o resumo avisa. */
export const WHATSAPP_HEARTBEAT_MAX_MS = 24 * 60 * 60 * 1000

export function heartbeatAlert(lastBeat: string | null, now: number): string | null {
  if (!lastBeat) return null
  if (now - Date.parse(lastBeat) <= WHATSAPP_HEARTBEAT_MAX_MS) return null
  const when = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(lastBeat))
    .replace(",", "")
  return `WhatsApp parado desde ${when}: confira o coletor no PC.`
}

export function composeDigest(
  today: string,
  rows: (DailyReviewRow & { companyName: string })[],
  openDecisions: number,
  appUrl: string,
  alerts: string[] = [],
  pend: { waitingYou: ConversationItem[]; waitingClient: ConversationItem[] } = { waitingYou: [], waitingClient: [] }
): Digest | null {
  const risco = rows.filter((r) => r.verdict === "risco")
  const sugestoes = rows.filter((r) => r.stageSuggestion || r.nextStep)
  const avanco = rows.filter((r) => r.verdict === "avanco")
  if (!alerts.length && !pend.waitingYou.length && !pend.waitingClient.length && !risco.length && !sugestoes.length && !avanco.length && openDecisions === 0) return null

  const card = (r: DailyReviewRow & { companyName: string }, extra = "") =>
    `<li><a href="${appUrl}/companies/${r.companyId}"><b>${esc(r.companyName)}</b></a>: ${esc(r.rationale)}${extra}</li>`
  const section = (title: string, items: string[]) => (items.length ? `<h3>${title}</h3><ul>${items.join("")}</ul>` : "")

  const ago = (h: number) => (h >= 48 ? `${Math.floor(h / 24)} dias` : `${h} h`)
  const conv = (c: ConversationItem) =>
    `<li><a href="${appUrl}/companies/${c.companyId}"><b>${esc(c.companyName)}</b></a>: ${esc(c.title)} — há ${ago(c.ageHours)}${c.preview ? ` <i>“${esc(c.preview.slice(-140))}”</i>` : ""}</li>`
  const pendLink = `<p><a href="${appUrl}/pendencias">Abrir Pendências</a></p>`

  const html = [
    alerts.length ? `<p style="color:#b91c1c"><b>${alerts.map(esc).join("<br/>")}</b></p>` : "",
    section(`Aguardando você (${pend.waitingYou.length})`, pend.waitingYou.map(conv)),
    section(`Aguardando o cliente (${pend.waitingClient.length})`, pend.waitingClient.map(conv)),
    pend.waitingYou.length || pend.waitingClient.length ? pendLink : "",
    `<p>Revisão de ${today}. Nada aqui mudou o funil: estágio só muda quando você confirmar no copiloto.</p>`,
    section(`Riscos (${risco.length})`, risco.map((r) => card(r))),
    section(
      `Sugestões para confirmar (${sugestoes.length})`,
      sugestoes.map((r) =>
        card(
          r,
          [r.stageSuggestion ? ` <i>→ mover para ${esc(r.stageSuggestion)}</i>` : "", r.nextStep ? ` <i>→ próximo passo: ${esc(r.nextStep)}</i>` : ""].join("")
        )
      )
    ),
    openDecisions ? `<h3>Decisões abertas</h3><p>${openDecisions} esperando você em <a href="${appUrl}/pendencias">Pendências</a>.</p>` : "",
    section(`Avanços (${avanco.length})`, avanco.map((r) => card(r))),
  ].join("\n")

  const parts = [
    pend.waitingYou.length ? `${pend.waitingYou.length} aguardando você` : null,
    pend.waitingClient.length ? `${pend.waitingClient.length} aguardando o cliente` : null,
    risco.length ? `${risco.length} risco${risco.length > 1 ? "s" : ""}` : null,
    sugestoes.length ? `${sugestoes.length} sugest${sugestoes.length > 1 ? "ões" : "ão"}` : null,
    avanco.length ? `${avanco.length} avanço${avanco.length > 1 ? "s" : ""}` : null,
  ].filter(Boolean)
  return {
    subject: `CRM ${today}: ${parts.join(", ") || (alerts.length ? "alerta do sistema" : `${openDecisions} decisões abertas`)}`,
    html,
    counts: { risco: risco.length, sugestoes: sugestoes.length, aguardandoVoce: pend.waitingYou.length, aguardandoCliente: pend.waitingClient.length, decisoes: openDecisions, avanco: avanco.length },
  }
}
