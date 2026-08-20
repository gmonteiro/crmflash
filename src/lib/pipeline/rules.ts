import { differenceInCalendarDays, parseISO, format } from "date-fns"
import {
  STALE_DAYS,
  FROZEN_DAYS,
  STAGE_DWELL_DAYS,
  STAGE_EXIT_CRITERIA,
  SIGNALS_BY_STAGE,
  SIGNAL_EXPECTED_FROM_POSITION,
  CHAMPION_EXPECTED_FROM_POSITION,
  COMMITMENT_SIGNALS,
  COPILOT_DAILY_LIMIT,
  COPILOT_MAX_PER_COMPANY,
} from "@/lib/constants"
import type { CommitmentSignalType } from "@/types/database"
import type { CopilotQuestion, CopilotQuickAction } from "@/types/copilot"
import type { PipelineSnapshot, SnapshotCompany, SnapshotColumn } from "./types"
import { colById, daysSinceClientEvent, daysInCurrentStage, isTerminal } from "./stages"

const signalLabel = (type: string): string =>
  COMMITMENT_SIGNALS.find((s) => s.value === type)?.label ?? type

const fmt = (iso: string) => format(parseISO(iso), "dd/MM")

// Contexto pré-computado uma vez e compartilhado por todas as regras.
interface RuleContext {
  snap: PipelineSnapshot
  byId: Map<string, SnapshotColumn>
  signalsByCompany: Map<string, CommitmentSignalType[]>
  stepsByCompany: Map<string, PipelineSnapshot["nextSteps"]>
  activitiesByCompany: Map<string, PipelineSnapshot["activities"]>
  peopleByCompany: Map<string, PipelineSnapshot["people"]>
}

function buildContext(snap: PipelineSnapshot): RuleContext {
  const signalsByCompany = new Map<string, CommitmentSignalType[]>()
  for (const s of snap.signals) {
    const arr = signalsByCompany.get(s.company_id) ?? []
    arr.push(s.signal_type)
    signalsByCompany.set(s.company_id, arr)
  }

  const stepsByCompany = new Map<string, PipelineSnapshot["nextSteps"]>()
  for (const s of snap.nextSteps) {
    const arr = stepsByCompany.get(s.company_id) ?? []
    arr.push(s)
    stepsByCompany.set(s.company_id, arr)
  }

  const activitiesByCompany = new Map<string, PipelineSnapshot["activities"]>()
  for (const a of snap.activities) {
    if (!a.company_id) continue
    const arr = activitiesByCompany.get(a.company_id) ?? []
    arr.push(a)
    activitiesByCompany.set(a.company_id, arr)
  }

  const peopleByCompany = new Map<string, PipelineSnapshot["people"]>()
  for (const p of snap.people) {
    if (!p.company_id) continue
    const arr = peopleByCompany.get(p.company_id) ?? []
    arr.push(p)
    peopleByCompany.set(p.company_id, arr)
  }

  return { snap, byId: colById(snap.columns), signalsByCompany, stepsByCompany, activitiesByCompany, peopleByCompany }
}

// Ação que apenas suprime a pergunta, sem escrever nada no CRM.
const skipAction = (id: string, label: string, suppressDays: number): CopilotQuickAction => ({
  id,
  label,
  variant: "outline",
  suppressDays,
  effects: [{ kind: "none" }],
})

// ---------------------------------------------------------------------------
// Regras
// ---------------------------------------------------------------------------

// 1. Reunião/call registrada nos últimos 2 dias — a pergunta mais valiosa de todas,
//    porque é quando a memória do que o cliente disse ainda está fresca.
function ruleMeetingYesterday(
  ctx: RuleContext,
  company: SnapshotCompany,
  stage: SnapshotColumn
): CopilotQuestion | null {
  const acts = ctx.activitiesByCompany.get(company.id) ?? []
  const recent = acts
    .filter((a) => a.type === "meeting" || a.type === "call")
    .filter((a) => {
      const d = differenceInCalendarDays(ctx.snap.now, parseISO(a.date))
      return d >= 0 && d <= 2
    })
    .sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime())

  const latest = recent[0]
  if (!latest) return null

  const kind = latest.type === "call" ? "uma call" : "uma reunião"

  return {
    key: `meeting_yesterday:${company.id}:${latest.id}`,
    ruleId: "meeting_yesterday",
    priority: 100,
    severity: 0,
    companyId: company.id,
    companyName: company.name,
    stageTitle: stage.title,
    entityId: latest.id,
    title: `Você teve ${kind} com ${company.name} em ${fmt(latest.date)}. Como foi?`,
    subtitle: `${stage.title} · ${latest.title}`,
    allowFreeText: true,
    actions: [
      {
        id: "advanced",
        label: "Avançou de estágio",
        suppressDays: 7,
        effects: [{ kind: "move_stage", target: "next" }],
      },
      {
        id: "held",
        label: "Aconteceu, sem avanço",
        variant: "outline",
        suppressDays: 5,
        effects: [
          { kind: "mark_client_event" },
          { kind: "note", text: "Reunião aconteceu, sem avanço de estágio" },
        ],
      },
      {
        id: "no_show",
        label: "Não aconteceu / remarcada",
        variant: "outline",
        suppressDays: 2,
        // Sem mark_client_event: reunião que não aconteceu não é evento do cliente.
        effects: [{ kind: "note", text: "Reunião não aconteceu / foi remarcada" }],
      },
    ],
  }
}

// 2. Próximo passo vencido.
function ruleNextStepOverdue(
  ctx: RuleContext,
  company: SnapshotCompany,
  stage: SnapshotColumn
): CopilotQuestion | null {
  const steps = ctx.stepsByCompany.get(company.id) ?? []
  const overdue = steps
    .filter((s) => s.due_date && differenceInCalendarDays(ctx.snap.now, parseISO(s.due_date)) > 0)
    .sort((a, b) => parseISO(a.due_date!).getTime() - parseISO(b.due_date!).getTime())

  const step = overdue[0]
  if (!step || !step.due_date) return null

  const lateDays = differenceInCalendarDays(ctx.snap.now, parseISO(step.due_date))

  return {
    key: `next_step_overdue:${company.id}:${step.id}`,
    ruleId: "next_step_overdue",
    priority: 95,
    severity: lateDays,
    companyId: company.id,
    companyName: company.name,
    stageTitle: stage.title,
    entityId: step.id,
    title: `O próximo passo «${step.title}» de ${company.name} venceu em ${fmt(step.due_date)}. Aconteceu?`,
    subtitle: `${stage.title} · ${lateDays}d de atraso`,
    allowFreeText: true,
    actions: [
      {
        id: "done",
        label: "Concluído",
        suppressDays: 7,
        // Concluir uma tarefa é ação do vendedor → não marca evento do cliente.
        effects: [{ kind: "complete_next_step", stepId: step.id }],
      },
      {
        id: "push3",
        label: "Remarcar +3 dias",
        variant: "outline",
        suppressDays: 3,
        effects: [{ kind: "reschedule_next_step", stepId: step.id, inDays: 3 }],
      },
      {
        id: "drop",
        label: "Não faz mais sentido",
        variant: "outline",
        suppressDays: 30,
        effects: [{ kind: "delete_next_step", stepId: step.id }],
      },
    ],
  }
}

// 3. Sem próximo passo agendado — a causa raiz mais comum de card que morre.
function ruleNoNextStep(
  ctx: RuleContext,
  company: SnapshotCompany,
  stage: SnapshotColumn
): CopilotQuestion | null {
  const steps = ctx.stepsByCompany.get(company.id) ?? []
  if (steps.length > 0) return null

  const mkStep = (inDays: number): CopilotQuickAction["effects"] => [
    { kind: "create_next_step", title: `Follow-up ${company.name}`, inDays },
  ]

  return {
    key: `no_next_step:${company.id}`,
    ruleId: "no_next_step",
    priority: 90,
    severity: 0,
    companyId: company.id,
    companyName: company.name,
    stageTitle: stage.title,
    title: `${company.name} está em ${stage.title} e não tem próximo passo agendado. Quando é o próximo toque?`,
    subtitle: stage.title,
    allowFreeText: true,
    actions: [
      { id: "tomorrow", label: "Amanhã", suppressDays: 3, effects: mkStep(1) },
      { id: "in3", label: "Em 3 dias", suppressDays: 3, effects: mkStep(3) },
      { id: "week", label: "Semana que vem", variant: "outline", suppressDays: 7, effects: mkStep(7) },
      skipAction("cold", "É alvo frio, sem passo", 14),
    ],
  }
}

// 4. Candidato a gelado: +30 dias (ou nunca) sem sinal do cliente.
function ruleFrozenCandidate(
  ctx: RuleContext,
  company: SnapshotCompany,
  stage: SnapshotColumn
): CopilotQuestion | null {
  const days = daysSinceClientEvent(company, ctx.snap.now)
  if (days !== null && days < FROZEN_DAYS) return null

  // Nunca teve evento: só cobra se já estiver no estágio há tempo suficiente,
  // senão toda conta recém-adicionada ao board vira pergunta no dia seguinte.
  if (days === null) {
    const inStage = daysInCurrentStage(company.id, stage.id, ctx.snap.events, ctx.snap.now)
    if (inStage !== null && inStage < FROZEN_DAYS) return null
  }

  const label = days === null ? "nenhum evento registrado" : `${days} dias`

  return {
    key: `frozen_candidate:${company.id}`,
    ruleId: "frozen_candidate",
    priority: 85,
    severity: days ?? 9999,
    companyId: company.id,
    companyName: company.name,
    stageTitle: stage.title,
    title: `${company.name}: ${label} sem nenhum sinal do cliente. Ainda está vivo?`,
    subtitle: `${stage.title} · candidato a gelado`,
    allowFreeText: true,
    actions: [
      {
        id: "alive",
        label: "Tive contato, está vivo",
        suppressDays: 7,
        effects: [{ kind: "mark_client_event" }],
      },
      {
        id: "freeze",
        label: "Mover para Gelado",
        variant: "outline",
        suppressDays: 90,
        effects: [
          { kind: "move_stage", target: "title", title: "Gelado" },
          { kind: "note", text: "Movido para Gelado pelo copiloto: sem sinal do cliente" },
        ],
      },
      {
        id: "lost",
        label: "Perdido",
        variant: "destructive",
        suppressDays: 365,
        effects: [{ kind: "move_stage", target: "title", title: "Perdido" }],
      },
      skipAction("wait", "Adiar 7 dias", 7),
    ],
  }
}

// 5. Card parado: entre 14 e 30 dias sem sinal do cliente.
function ruleStalledCard(
  ctx: RuleContext,
  company: SnapshotCompany,
  stage: SnapshotColumn
): CopilotQuestion | null {
  const days = daysSinceClientEvent(company, ctx.snap.now)
  if (days === null || days < STALE_DAYS || days >= FROZEN_DAYS) return null

  return {
    key: `stalled_card:${company.id}`,
    ruleId: "stalled_card",
    priority: 80,
    severity: days,
    companyId: company.id,
    companyName: company.name,
    stageTitle: stage.title,
    title: `${company.name} está há ${days} dias sem sinal do cliente. Teve algum contato que não registrei?`,
    subtitle: `${stage.title} · há ${days}d`,
    allowFreeText: true,
    actions: [
      {
        id: "replied",
        label: "Cliente respondeu",
        suppressDays: 7,
        effects: [{ kind: "mark_client_event" }],
      },
      {
        id: "chasing",
        label: "Cobrei, aguardando",
        variant: "outline",
        suppressDays: 3,
        // Cobrar é ação do vendedor → não marca evento do cliente.
        effects: [{ kind: "note", text: "Cobrança enviada, aguardando retorno" }],
      },
      {
        id: "draft",
        label: "Redigir retomada",
        variant: "secondary",
        suppressDays: 0,
        effects: [{ kind: "open_drafts", draftKind: "retomada" }],
      },
      skipAction("silence", "Sem retorno", 5),
    ],
  }
}

// 6. Estágio avançado sem nenhum sinal de compromisso capturado — o sintoma
//    clássico de card que "avançou" só na cabeça do vendedor.
function ruleNoSignalPastStage(
  ctx: RuleContext,
  company: SnapshotCompany,
  stage: SnapshotColumn
): CopilotQuestion | null {
  if (stage.position < SIGNAL_EXPECTED_FROM_POSITION) return null
  const captured = ctx.signalsByCompany.get(company.id) ?? []
  if (captured.length > 0) return null

  const suggested = (SIGNALS_BY_STAGE[stage.title] ?? [
    "asked_price",
    "shared_real_data",
    "second_interlocutor",
  ]) as CommitmentSignalType[]

  const actions: CopilotQuickAction[] = suggested.map((sig) => ({
    id: `signal_${sig}`,
    label: signalLabel(sig),
    suppressDays: 7,
    effects: [{ kind: "capture_signal", signal: sig, label: signalLabel(sig) }],
  }))
  actions.push(skipAction("none_yet", "Nenhum ainda", 7))

  return {
    key: `no_signal_past_stage:${company.id}`,
    ruleId: "no_signal_past_stage",
    priority: 70,
    severity: stage.position,
    companyId: company.id,
    companyName: company.name,
    stageTitle: stage.title,
    title: `${company.name} já está em ${stage.title}, mas nenhum sinal de compromisso foi registrado. O cliente fez algo que custa a ele?`,
    subtitle: `${stage.title} · 0 sinais`,
    allowFreeText: true,
    actions,
  }
}

// 7. Muito tempo no mesmo estágio sem bater o critério de saída.
function ruleExitCriteriaUnmet(
  ctx: RuleContext,
  company: SnapshotCompany,
  stage: SnapshotColumn
): CopilotQuestion | null {
  const criteria = STAGE_EXIT_CRITERIA[stage.title]
  if (!criteria) return null

  const inStage = daysInCurrentStage(company.id, stage.id, ctx.snap.events, ctx.snap.now)
  if (inStage === null || inStage < STAGE_DWELL_DAYS) return null

  return {
    key: `exit_criteria_unmet:${company.id}:${stage.id}`,
    ruleId: "exit_criteria_unmet",
    priority: 60,
    severity: inStage,
    companyId: company.id,
    companyName: company.name,
    stageTitle: stage.title,
    title: `${company.name} está em «${stage.title}» há ${inStage} dias. Critério de saída: «${criteria}». Já bateu?`,
    subtitle: `${stage.title} · ${inStage}d no estágio`,
    allowFreeText: true,
    actions: [
      {
        id: "met",
        label: "Já bateu",
        suppressDays: 7,
        effects: [{ kind: "move_stage", target: "next" }],
      },
      skipAction("not_yet", "Ainda não", 7),
      {
        id: "regress",
        label: "Não vai bater, voltar",
        variant: "outline",
        suppressDays: 14,
        effects: [{ kind: "move_stage", target: "prev" }],
      },
    ],
  }
}

// 8. Champion não mapeado num estágio que já exige isso.
function ruleMissingChampion(
  ctx: RuleContext,
  company: SnapshotCompany,
  stage: SnapshotColumn
): CopilotQuestion | null {
  if (stage.position < CHAMPION_EXPECTED_FROM_POSITION) return null
  if (company.champion_name) return null

  const people = (ctx.peopleByCompany.get(company.id) ?? []).slice(0, 3)
  const actions: CopilotQuickAction[] = people.map((p) => ({
    id: `person_${p.id}`,
    label: p.full_name,
    suppressDays: 7,
    effects: [{ kind: "set_field", field: "champion_name", value: p.full_name }],
  }))
  actions.push(skipAction("unknown", "Não sei ainda", 14))

  return {
    key: `missing_champion:${company.id}`,
    ruleId: "missing_champion",
    priority: 50,
    severity: stage.position,
    companyId: company.id,
    companyName: company.name,
    stageTitle: stage.title,
    title: `Quem é o champion em ${company.name} — a pessoa que defende isso internamente?`,
    subtitle: `${stage.title} · sem champion`,
    allowFreeText: true,
    actions,
  }
}

// 9. Hipótese de dor ausente no topo do funil.
function ruleMissingPainHypothesis(
  ctx: RuleContext,
  company: SnapshotCompany,
  stage: SnapshotColumn
): CopilotQuestion | null {
  if (stage.position > 2) return null
  if (company.pain_hypothesis) return null

  return {
    key: `missing_pain_hypothesis:${company.id}`,
    ruleId: "missing_pain_hypothesis",
    priority: 40,
    severity: 0,
    companyId: company.id,
    companyName: company.name,
    stageTitle: stage.title,
    title: `Qual a hipótese de dor de ${company.name}, na linguagem do cliente?`,
    subtitle: `${stage.title} · sem hipótese de dor`,
    allowFreeText: true,
    actions: [skipAction("skip", "Pular", 14)],
  }
}

// ---------------------------------------------------------------------------

const RULES = [
  ruleMeetingYesterday,
  ruleNextStepOverdue,
  ruleNoNextStep,
  ruleFrozenCandidate,
  ruleStalledCard,
  ruleNoSignalPastStage,
  ruleExitCriteriaUnmet,
  ruleMissingChampion,
  ruleMissingPainHypothesis,
] as const

export interface DetectOptions {
  limit?: number
  maxPerCompany?: number
}

// Roda todas as regras sobre o snapshot, descarta as chaves suprimidas e devolve
// a fila do dia ordenada por prioridade → severidade.
export function detectQuestions(
  snap: PipelineSnapshot,
  suppressedKeys: Set<string>,
  opts: DetectOptions = {}
): CopilotQuestion[] {
  const { limit = COPILOT_DAILY_LIMIT, maxPerCompany = COPILOT_MAX_PER_COMPANY } = opts
  const ctx = buildContext(snap)
  const found: CopilotQuestion[] = []

  for (const company of snap.companies) {
    const stage = ctx.byId.get(company.kanban_column_id)
    if (!stage) continue
    // Estágios terminais não geram pergunta: o card já chegou ao fim.
    if (isTerminal(stage.title)) continue

    for (const rule of RULES) {
      const q = rule(ctx, company, stage)
      if (q && !suppressedKeys.has(q.key)) found.push(q)
    }
  }

  found.sort((a, b) => b.priority - a.priority || b.severity - a.severity)

  const perCompany = new Map<string, number>()
  const queue: CopilotQuestion[] = []
  for (const q of found) {
    const n = perCompany.get(q.companyId) ?? 0
    if (n >= maxPerCompany) continue
    perCompany.set(q.companyId, n + 1)
    queue.push(q)
    if (queue.length >= limit) break
  }

  return queue
}
