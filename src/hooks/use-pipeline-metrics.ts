"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { STALE_DAYS, FROZEN_DAYS, COMMITMENT_SIGNALS } from "@/lib/constants"
import { differenceInCalendarDays, parseISO } from "date-fns"
import type { CommitmentSignalType } from "@/types/database"

const TERMINAL = new Set(["Ganho", "Perdido", "Gelado"])
const OUTCOME = new Set(["Perdido", "Gelado"]) // fora do funil principal
const MS_PER_DAY = 1000 * 60 * 60 * 24

interface Column {
  id: string
  title: string
  color: string
  position: number
}
interface BoardCompany {
  id: string
  name: string
  kanban_column_id: string
  last_client_event_at: string | null
}
interface StageEvent {
  company_id: string
  from_title: string | null
  to_title: string | null
  to_position: number | null
  direction: "enter" | "advance" | "retreat" | "frozen"
  occurred_at: string
}
interface Signal {
  company_id: string
  signal_type: CommitmentSignalType
  captured_at: string
}

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

export function usePipelineMetrics(windowDays = 7) {
  const [metrics, setMetrics] = useState<PipelineMetrics | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchMetrics = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    const [colsRes, companiesRes, eventsRes, signalsRes] = await Promise.all([
      supabase.from("kanban_columns").select("id, title, color, position").order("position"),
      supabase
        .from("companies")
        .select("id, name, kanban_column_id, last_client_event_at")
        .not("kanban_column_id", "is", null),
      supabase
        .from("company_stage_events")
        .select("company_id, from_title, to_title, to_position, direction, occurred_at")
        .order("occurred_at", { ascending: true }),
      supabase
        .from("company_commitment_signals")
        .select("company_id, signal_type, captured_at"),
    ])

    const columns = (colsRes.data ?? []) as Column[]
    const board = (companiesRes.data ?? []) as BoardCompany[]
    const events = (eventsRes.data ?? []) as StageEvent[]
    const signals = (signalsRes.data ?? []) as Signal[]

    const now = new Date()
    const windowStart = new Date(now.getTime() - windowDays * MS_PER_DAY)
    const colById = new Map(columns.map((c) => [c.id, c]))

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
    const activeCols = columns.filter((c) => !TERMINAL.has(c.title))
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
    const mainPath = columns.filter((c) => !OUTCOME.has(c.title)) // Alvos..Ganho
    const mainIndex = new Map(mainPath.map((c, i) => [c.title, i]))
    const furthest = new Map<string, number>() // company_id -> maior índice main-path

    const bump = (companyId: string, title: string | null | undefined) => {
      if (!title) return
      const idx = mainIndex.get(title)
      if (idx === undefined) return
      furthest.set(companyId, Math.max(furthest.get(companyId) ?? -1, idx))
    }
    for (const c of board) bump(c.id, colById.get(c.kanban_column_id)?.title)
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
      .filter((c) => OUTCOME.has(c.title))
      .map((col) => ({
        title: col.title,
        color: col.color,
        count: board.filter((c) => c.kanban_column_id === col.id).length,
      }))

    // --- 6. Tempo médio em cada estágio (a partir dos segmentos entre eventos) ---
    const byCompany = new Map<string, StageEvent[]>()
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

    setMetrics({
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
    })
    setLoading(false)
  }, [windowDays])

  useEffect(() => {
    fetchMetrics()
  }, [fetchMetrics])

  return { metrics, loading, refetch: fetchMetrics }
}
