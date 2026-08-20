import { differenceInCalendarDays, parseISO } from "date-fns"
import { STALE_DAYS, FROZEN_DAYS, COMMITMENT_SIGNALS } from "@/lib/constants"
import type { CommitmentSignalType } from "@/types/database"
import type { PipelineSnapshot, SnapshotStageEvent } from "./types"
import { TERMINAL_STAGES, OUTCOME_STAGES, MS_PER_DAY, colById } from "./stages"

export interface PipelineMetrics {
  windowDays: number
  totalOnBoard: number
  // 1. Movimentos líquidos (janela)
  net: { advance: number; regress: number; net: number }
  // 2. Sinais capturados na janela
  signalsWeek: number
  signalsByType: { type: CommitmentSignalType; label: string; count: number }[]
  // 3. Cards parados por estágio (>= STALE_DAYS sem evento do cliente)
  stalled: {
    title: string
    color: string
    total: number
    parados: number // >= STALE_DAYS
    frozen: number // >= FROZEN_DAYS ou nunca
    companies: { id: string; name: string; days: number | null }[]
  }[]
  totalStalled: number
  // 4. Novos qualificados na janela (entraram no 2º estágio)
  qualifiedStageTitle: string | null
  qualifiedWeek: number
  // 5. Funil de conversão acumulada
  funnel: {
    title: string
    color: string
    reached: number
    conversionFromPrev: number | null // 0..1
  }[]
  outcomes: { title: string; color: string; count: number }[]
  // 6. Tempo médio em cada estágio (dias)
  avgTime: { title: string; color: string; avgDays: number; samples: number }[]
}

export function computePipelineMetrics(
  snap: PipelineSnapshot,
  opts: { windowDays: number }
): PipelineMetrics {
  const { windowDays } = opts
  const { now, columns, companies: board, events, signals } = snap

  const windowStart = new Date(now.getTime() - windowDays * MS_PER_DAY)
  const byId = colById(columns)

  // --- 1. Movimentos líquidos na janela ---
  let advance = 0
  let regress = 0
  for (const e of events) {
    if (parseISO(e.occurred_at) < windowStart) continue
    if (e.direction === "advance") advance++
    else if (e.direction === "retreat" || e.direction === "frozen") regress++
  }

  // --- 2. Sinais na janela ---
  const byType = new Map<CommitmentSignalType, number>()
  let signalsWeek = 0
  for (const s of signals) {
    if (parseISO(s.captured_at) < windowStart) continue
    signalsWeek++
    byType.set(s.signal_type, (byType.get(s.signal_type) ?? 0) + 1)
  }
  const signalsByType = COMMITMENT_SIGNALS.map((sig) => ({
    type: sig.value as CommitmentSignalType,
    label: sig.label,
    count: byType.get(sig.value as CommitmentSignalType) ?? 0,
  }))

  // --- 3. Cards parados por estágio (só pipeline ativo, exclui terminais) ---
  const activeCols = columns.filter((c) => !TERMINAL_STAGES.has(c.title))
  const stalled = activeCols.map((col) => {
    const inCol = board.filter((c) => c.kanban_column_id === col.id)
    const companies = inCol.map((c) => ({
      id: c.id,
      name: c.name,
      days: c.last_client_event_at
        ? differenceInCalendarDays(now, parseISO(c.last_client_event_at))
        : null,
    }))
    const parados = companies.filter((c) => c.days === null || c.days >= STALE_DAYS)
    const frozen = companies.filter((c) => c.days === null || c.days >= FROZEN_DAYS)
    return {
      title: col.title,
      color: col.color,
      total: inCol.length,
      parados: parados.length,
      frozen: frozen.length,
      companies: parados.sort((a, b) => (b.days ?? 9999) - (a.days ?? 9999)),
    }
  })
  const totalStalled = stalled.reduce((sum, s) => sum + s.parados, 0)

  // --- 4. Novos qualificados na janela (entraram no 2º estágio do board) ---
  const qualifiedCol = columns[1] ?? null
  const qualifiedStageTitle = qualifiedCol?.title ?? null
  const qualifiedCompanies = new Set<string>()
  if (qualifiedStageTitle) {
    for (const e of events) {
      if (parseISO(e.occurred_at) < windowStart) continue
      if (e.to_title === qualifiedStageTitle) qualifiedCompanies.add(e.company_id)
    }
  }

  // --- 5. Funil: furthest main-path stage alcançado por empresa ---
  const mainPath = columns.filter((c) => !OUTCOME_STAGES.has(c.title)) // Alvos..Ganho
  const mainIndex = new Map(mainPath.map((c, i) => [c.title, i]))
  const furthest = new Map<string, number>() // company_id -> maior índice main-path

  const bump = (companyId: string, title: string | null | undefined) => {
    if (!title) return
    const idx = mainIndex.get(title)
    if (idx === undefined) return
    furthest.set(companyId, Math.max(furthest.get(companyId) ?? -1, idx))
  }
  for (const c of board) bump(c.id, byId.get(c.kanban_column_id)?.title)
  for (const e of events) bump(e.company_id, e.to_title)

  const funnel = mainPath.map((col, i) => {
    let reached = 0
    for (const idx of furthest.values()) if (idx >= i) reached++
    return { title: col.title, color: col.color, reached, conversionFromPrev: null as number | null }
  })
  for (let i = 1; i < funnel.length; i++) {
    const prev = funnel[i - 1].reached
    funnel[i].conversionFromPrev = prev > 0 ? funnel[i].reached / prev : null
  }

  // Outcomes fora do funil
  const outcomes = columns
    .filter((c) => OUTCOME_STAGES.has(c.title))
    .map((col) => ({
      title: col.title,
      color: col.color,
      count: board.filter((c) => c.kanban_column_id === col.id).length,
    }))

  // --- 6. Tempo médio em cada estágio (a partir dos segmentos entre eventos) ---
  const byCompany = new Map<string, SnapshotStageEvent[]>()
  for (const e of events) {
    const arr = byCompany.get(e.company_id) ?? []
    arr.push(e)
    byCompany.set(e.company_id, arr)
  }
  const durSum = new Map<string, number>() // title -> soma de dias
  const durCount = new Map<string, number>()
  for (const evs of byCompany.values()) {
    const sorted = [...evs].sort(
      (a, b) => parseISO(a.occurred_at).getTime() - parseISO(b.occurred_at).getTime()
    )
    for (let i = 0; i < sorted.length; i++) {
      const title = sorted[i].to_title
      if (!title) continue
      const start = parseISO(sorted[i].occurred_at).getTime()
      const end = i + 1 < sorted.length ? parseISO(sorted[i + 1].occurred_at).getTime() : now.getTime()
      const days = Math.max(0, (end - start) / MS_PER_DAY)
      durSum.set(title, (durSum.get(title) ?? 0) + days)
      durCount.set(title, (durCount.get(title) ?? 0) + 1)
    }
  }
  const avgTime = columns
    .filter((c) => (durCount.get(c.title) ?? 0) > 0)
    .map((col) => ({
      title: col.title,
      color: col.color,
      avgDays: (durSum.get(col.title) ?? 0) / (durCount.get(col.title) ?? 1),
      samples: durCount.get(col.title) ?? 0,
    }))

  return {
    windowDays,
    totalOnBoard: board.length,
    net: { advance, regress, net: advance - regress },
    signalsWeek,
    signalsByType,
    stalled,
    totalStalled,
    qualifiedStageTitle,
    qualifiedWeek: qualifiedCompanies.size,
    funnel,
    outcomes,
    avgTime,
  }
}
