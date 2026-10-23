import Anthropic from "@anthropic-ai/sdk"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import { z } from "zod"
import { COMMITMENT_SIGNALS, DEFAULT_KANBAN_COLUMNS, STAGE_EXIT_CRITERIA } from "@/lib/constants"
import type { CompanyContext } from "./store"

// Extração da reunião: o que a call diz sobre a conta, sempre com a citação
// literal de onde tirou. A citação é conferida no servidor (verifyExtraction):
// item cuja frase não está na transcrição é descartado, não importa quão
// plausível pareça.

export const EXTRACTION_PROMPT_VERSION = "extracao-reuniao-v1"
export const EXTRACTION_MODEL = process.env.EXTRACTION_MODEL ?? "claude-opus-5-5"

const SIGNAL_VALUES = COMMITMENT_SIGNALS.map((s) => s.value) as [string, ...string[]]

const EvidenceZ = z.object({
  segment: z.number().int().describe("Número do trecho, como aparece entre colchetes."),
  speaker: z.string(),
  quote: z.string().describe("Frase copiada LITERALMENTE do trecho. Até ~300 caracteres."),
})

const PersonPickZ = z.object({
  name: z.string(),
  rationale: z.string(),
  evidence: z.array(EvidenceZ),
})

export const ExtractionZ = z.object({
  summary: z.string().describe("Resumo da call em português, até ~1200 caracteres."),
  champion: PersonPickZ.nullable(),
  economic_buyer: PersonPickZ.nullable(),
  pain_hypothesis: z.object({ text: z.string(), evidence: z.array(EvidenceZ) }).nullable(),
  signals: z.array(z.object({ type: z.enum(SIGNAL_VALUES), evidence: z.array(EvidenceZ) })),
  next_steps: z.array(
    z.object({
      title: z.string(),
      owner: z.enum(["lumeis", "client"]),
      assignee: z.string().nullable(),
      due_date: z.string().nullable().describe("AAAA-MM-DD, ou null."),
      due_basis: z.enum(["explicit", "inferred", "none"]),
      evidence: z.array(EvidenceZ),
    })
  ),
  stage_suggestion: z
    .object({ target_stage: z.string(), rationale: z.string(), evidence: z.array(EvidenceZ) })
    .nullable(),
})

export type Extraction = z.infer<typeof ExtractionZ>
export type ExtractionEvidence = z.infer<typeof EvidenceZ>

export interface TranscriptLine {
  segment: number
  speaker: string
  text: string
}

export interface ExtractionInput {
  company: CompanyContext
  meetingTitle: string
  meetingDate: string
  participants: { name: string; side: "lumeis" | "cliente"; email: string | null }[]
  lines: TranscriptLine[]
}

export function renderTranscript(lines: TranscriptLine[]): string {
  return lines.map((l) => `[${l.segment}] ${l.speaker}: ${l.text}`).join("\n")
}

export function buildExtractionPrompt(input: ExtractionInput): { system: string; user: string } {
  const c = input.company
  const stages = DEFAULT_KANBAN_COLUMNS.map((s) => s.title).join(" → ")
  const criteria = Object.entries(STAGE_EXIT_CRITERIA)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n")
  const signals = COMMITMENT_SIGNALS.map((s) => `- ${s.value}: ${s.label}`).join("\n")

  const system = [
    "Você lê a transcrição de uma reunião comercial da Lumeis e extrai o que ela diz sobre a conta do cliente.",
    "Regras que não têm exceção:",
    "1. Toda afirmação precisa de evidência: o número do trecho e uma frase copiada LITERALMENTE dele. Se não há frase que sustente, não afirme — devolva null ou lista vazia.",
    "2. Sinal de compromisso é algo que o CLIENTE fez ou se comprometeu a fazer e que custa a ele. Intenção vaga ('seria legal ver um dia') não é sinal.",
    "3. Champion é quem defende a compra por dentro; comprador econômico é quem aprova o dinheiro. Não confunda cargo alto com comprador.",
    "4. Prazo: 'explicit' só com data ou dia dito na call; 'inferred' quando a frase dá o prazo de forma relativa ('semana que vem') — converta a partir da data da reunião; senão 'none' e due_date null.",
    "5. Sugestão de estágio só quando o critério de saída do estágio atual foi claramente cumprido na call. Na dúvida, null.",
    "6. Transcrição automática erra palavras. Cite o texto como ele está, mesmo errado.",
  ].join("\n")

  const user = [
    `Empresa: ${c.name}`,
    `Estágio atual: ${c.stageTitle ?? "(fora do funil)"}`,
    `Funil: ${stages}`,
    `Critérios de saída:\n${criteria}`,
    `Champion registrado: ${c.championName ?? "(vazio)"}`,
    `Comprador econômico registrado: ${c.economicBuyerName ?? "(vazio)"}`,
    `Hipótese de dor registrada: ${c.painHypothesis ?? "(vazia)"}`,
    `Sinais já capturados: ${c.signals.length ? c.signals.join(", ") : "(nenhum)"}`,
    `Próximos passos abertos: ${c.openNextSteps.length ? c.openNextSteps.map((s) => s.title).join("; ") : "(nenhum)"}`,
    `Sinais possíveis:\n${signals}`,
    "",
    `Reunião: ${input.meetingTitle} — ${input.meetingDate}`,
    `Participantes:\n${input.participants.map((p) => `- ${p.name} (${p.side}${p.email ? `, ${p.email}` : ""})`).join("\n")}`,
    "",
    "Transcrição (cada linha: [trecho] falante: texto):",
    renderTranscript(input.lines),
  ].join("\n")

  return { system, user }
}

function squash(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

/** A citação está mesmo no trecho indicado (ou, por tolerância, em qualquer trecho)? */
export function quoteIsLiteral(ev: ExtractionEvidence, lines: TranscriptLine[]): boolean {
  const q = squash(ev.quote)
  if (q.length < 8) return false
  const at = lines.find((l) => l.segment === ev.segment)
  if (at && squash(at.text).includes(q)) return true
  return lines.some((l) => squash(l.text).includes(q))
}

export interface VerifiedExtraction {
  extraction: Extraction
  dropped: { field: string; reason: string }[]
}

/**
 * Descarta o que não tem evidência literal. Não "conserta" nada: item sem
 * citação válida sai inteiro, e o motivo fica registrado em `dropped`.
 */
export function verifyExtraction(raw: Extraction, lines: TranscriptLine[]): VerifiedExtraction {
  const dropped: { field: string; reason: string }[] = []
  const keepEvidence = (field: string, evs: ExtractionEvidence[]) => {
    const ok = evs.filter((e) => quoteIsLiteral(e, lines))
    if (ok.length === 0) dropped.push({ field, reason: evs.length ? "citacao_nao_literal" : "sem_evidencia" })
    return ok
  }

  const pick = <T extends { evidence: ExtractionEvidence[] }>(field: string, v: T | null): T | null => {
    if (!v) return null
    const evidence = keepEvidence(field, v.evidence)
    return evidence.length ? { ...v, evidence } : null
  }

  const next_steps = raw.next_steps
    .map((s, i) => {
      const evidence = keepEvidence(`next_step:${i}`, s.evidence)
      if (!evidence.length) return null
      // Prazo inferido sem frase não entra: vira passo sem prazo.
      const dueOk = s.due_basis === "none" || /^\d{4}-\d{2}-\d{2}$/.test(s.due_date ?? "")
      return dueOk ? { ...s, evidence } : { ...s, evidence, due_date: null, due_basis: "none" as const }
    })
    .filter((s): s is NonNullable<typeof s> => !!s)

  return {
    extraction: {
      summary: raw.summary,
      champion: pick("champion", raw.champion),
      economic_buyer: pick("economic_buyer", raw.economic_buyer),
      pain_hypothesis: pick("pain_hypothesis", raw.pain_hypothesis),
      signals: raw.signals
        .map((s) => pick(`signal:${s.type}`, s))
        .filter((s): s is NonNullable<typeof s> => !!s),
      next_steps,
      stage_suggestion: pick("stage_suggestion", raw.stage_suggestion),
    },
    dropped,
  }
}

export interface Extractor {
  extract(input: ExtractionInput): Promise<Extraction>
}

export class ClaudeExtractor implements Extractor {
  constructor(private readonly client = new Anthropic()) {}

  async extract(input: ExtractionInput): Promise<Extraction> {
    const { system, user } = buildExtractionPrompt(input)
    // Streaming: transcrição de 1 h + saída estruturada passa fácil do timeout
    // de uma request comum.
    const stream = this.client.messages.stream({
      model: EXTRACTION_MODEL,
      max_tokens: 32000,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort: "medium", format: zodOutputFormat(ExtractionZ) },
    })
    const message = await stream.finalMessage()

    if (message.stop_reason === "refusal") throw new Error("Extração recusada pelo modelo")
    if (message.stop_reason === "max_tokens") throw new Error("Extração cortada por max_tokens")

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
    return ExtractionZ.parse(JSON.parse(text))
  }
}
