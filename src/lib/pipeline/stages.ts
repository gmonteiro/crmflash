import { differenceInCalendarDays, parseISO } from "date-fns"
import type { SnapshotColumn, SnapshotCompany, SnapshotStageEvent } from "./types"

// Estágios terminais: card não avança mais, então não conta como "parado".
export const TERMINAL_STAGES = new Set(["Ganho", "Perdido", "Gelado"])
// Desfechos fora do funil principal (o funil vai de Alvos até Ganho).
export const OUTCOME_STAGES = new Set(["Perdido", "Gelado"])

export const MS_PER_DAY = 1000 * 60 * 60 * 24

export function isTerminal(title: string | null | undefined): boolean {
  return !!title && TERMINAL_STAGES.has(title)
}

export function isOutcome(title: string | null | undefined): boolean {
  return !!title && OUTCOME_STAGES.has(title)
}

export function colById(columns: SnapshotColumn[]): Map<string, SnapshotColumn> {
  return new Map(columns.map((c) => [c.id, c]))
}

export function stageOf(
  company: SnapshotCompany,
  byId: Map<string, SnapshotColumn>
): SnapshotColumn | null {
  return byId.get(company.kanban_column_id) ?? null
}

export function stageByTitle(columns: SnapshotColumn[], title: string): SnapshotColumn | null {
  return columns.find((c) => c.title === title) ?? null
}

// Dias desde o último evento DO CLIENTE. null = nunca teve.
export function daysSinceClientEvent(company: SnapshotCompany, now: Date): number | null {
  if (!company.last_client_event_at) return null
  return differenceInCalendarDays(now, parseISO(company.last_client_event_at))
}

// Próximo/anterior estágio no funil principal (pula Perdido/Gelado, que não são
// passos do funil e sim desfechos). Retorna null quando não há para onde ir.
export function nextStage(
  columns: SnapshotColumn[],
  current: SnapshotColumn
): SnapshotColumn | null {
  const path = columns.filter((c) => !isOutcome(c.title))
  const i = path.findIndex((c) => c.id === current.id)
  if (i === -1) return null
  return path[i + 1] ?? null
}

export function prevStage(
  columns: SnapshotColumn[],
  current: SnapshotColumn
): SnapshotColumn | null {
  const path = columns.filter((c) => !isOutcome(c.title))
  const i = path.findIndex((c) => c.id === current.id)
  if (i <= 0) return null
  return path[i - 1] ?? null
}

// Há quantos dias a empresa está na coluna atual, a partir do último stage event
// que a colocou lá. null = sem histórico (entrou no board antes da migration 008).
export function daysInCurrentStage(
  companyId: string,
  columnId: string,
  events: SnapshotStageEvent[],
  now: Date
): number | null {
  let latest: number | null = null
  for (const e of events) {
    if (e.company_id !== companyId) continue
    if (e.to_column_id !== columnId) continue
    const t = parseISO(e.occurred_at).getTime()
    if (latest === null || t > latest) latest = t
  }
  if (latest === null) return null
  return Math.max(0, Math.floor((now.getTime() - latest) / MS_PER_DAY))
}
