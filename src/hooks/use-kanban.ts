"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import type { KanbanColumn, Company } from "@/types/database"
import type { KanbanColumnWithCards, KanbanCardCompany } from "@/types/kanban"
import { calculatePosition } from "@/lib/kanban/position"

export function useKanban() {
  const [columns, setColumns] = useState<KanbanColumnWithCards[]>([])
  const [loading, setLoading] = useState(true)

  const fetchBoard = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    const { data: cols } = await supabase
      .from("kanban_columns")
      .select("*")
      .order("position")

    if (!cols) {
      setLoading(false)
      return
    }

    const { data: companies } = await supabase
      .from("companies")
      .select("*")
      .not("kanban_column_id", "is", null)
      .order("kanban_position")

    const companyIds = ((companies ?? []) as Company[]).map((c) => c.id)

    // Campos derivados: contagem de sinais de compromisso + próximo passo pendente por empresa.
    const signalCounts = new Map<string, number>()
    const nextStepDue = new Map<string, string>()

    if (companyIds.length > 0) {
      const [signalsRes, stepsRes] = await Promise.all([
        supabase
          .from("company_commitment_signals")
          .select("company_id")
          .in("company_id", companyIds),
        supabase
          .from("company_next_steps")
          .select("company_id, due_date")
          .in("company_id", companyIds)
          .eq("status", "pending")
          .not("due_date", "is", null)
          .order("due_date", { ascending: true }),
      ])

      for (const row of (signalsRes.data ?? []) as { company_id: string }[]) {
        signalCounts.set(row.company_id, (signalCounts.get(row.company_id) ?? 0) + 1)
      }
      // ordenado por due_date asc → o primeiro visto por empresa é o mais próximo
      for (const row of (stepsRes.data ?? []) as { company_id: string; due_date: string }[]) {
        if (!nextStepDue.has(row.company_id)) nextStepDue.set(row.company_id, row.due_date)
      }
    }

    const columnsWithCards: KanbanColumnWithCards[] = (cols as KanbanColumn[]).map((col) => ({
      ...col,
      cards: ((companies ?? []) as Company[])
        .filter((c: Company) => c.kanban_column_id === col.id)
        .map((c): KanbanCardCompany => ({
          ...c,
          signalCount: signalCounts.get(c.id) ?? 0,
          nextStepDue: nextStepDue.get(c.id) ?? null,
        })),
    }))

    setColumns(columnsWithCards)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchBoard()
  }, [fetchBoard])

  async function moveCard(
    companyId: string,
    targetColumnId: string,
    targetIndex: number
  ) {
    const targetCol = columns.find((c) => c.id === targetColumnId)
    if (!targetCol) return

    // Coluna de origem (para logar direção do movimento).
    const fromCol = columns.find((c) => c.cards.some((card) => card.id === companyId))

    const cards = targetCol.cards.filter((c) => c.id !== companyId)
    const newPosition = calculatePosition(cards, targetIndex)

    // Optimistic update
    setColumns((prev) =>
      prev.map((col) => {
        const filteredCards = col.cards.filter((c) => c.id !== companyId)
        if (col.id === targetColumnId) {
          const movedCard = prev
            .flatMap((c) => c.cards)
            .find((c) => c.id === companyId)
          if (!movedCard) return { ...col, cards: filteredCards }
          const updatedCard = {
            ...movedCard,
            kanban_column_id: targetColumnId,
            kanban_position: newPosition,
          }
          const newCards = [...filteredCards]
          newCards.splice(targetIndex, 0, updatedCard)
          return { ...col, cards: newCards }
        }
        return { ...col, cards: filteredCards }
      })
    )

    const supabase = createClient()

    // Se mudou de coluna, determina a direção e loga o evento de estágio.
    const changedColumn = !fromCol || fromCol.id !== targetColumnId
    let direction: "enter" | "advance" | "retreat" | "frozen" | null = null
    if (changedColumn) {
      const isFrozen = /gelad/i.test(targetCol.title)
      if (!fromCol) direction = "enter"
      else if (isFrozen) direction = "frozen"
      else if (targetCol.position > fromCol.position) direction = "advance"
      else if (targetCol.position < fromCol.position) direction = "retreat"
      else direction = "advance"
    }

    // Avanço reflete uma ação do cliente → registra evento do cliente.
    const bumpClientEvent = direction === "advance"

    const companyUpdate: Record<string, unknown> = {
      kanban_column_id: targetColumnId,
      kanban_position: newPosition,
    }
    if (bumpClientEvent) companyUpdate.last_client_event_at = new Date().toISOString()

    await supabase.from("companies").update(companyUpdate).eq("id", companyId)

    if (direction) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from("company_stage_events").insert({
          user_id: user.id,
          company_id: companyId,
          from_column_id: fromCol?.id ?? null,
          to_column_id: targetColumnId,
          from_title: fromCol?.title ?? null,
          to_title: targetCol.title,
          from_position: fromCol?.position ?? null,
          to_position: targetCol.position,
          direction,
        })
      }
    }
  }

  async function reorderColumns(activeId: string, overIndex: number) {
    const oldIndex = columns.findIndex((c) => c.id === activeId)
    if (oldIndex === -1) return

    const reordered = [...columns]
    const [moved] = reordered.splice(oldIndex, 1)
    reordered.splice(overIndex, 0, moved)

    // Recalculate positions
    const updated = reordered.map((col, idx) => ({
      ...col,
      position: idx + 1,
    }))

    setColumns(updated)

    const supabase = createClient()
    for (const col of updated) {
      await supabase
        .from("kanban_columns")
        .update({ position: col.position })
        .eq("id", col.id)
    }
  }

  async function addColumn(title: string, color: string) {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const maxPos = columns.length > 0 ? Math.max(...columns.map((c) => c.position)) : 0

    const { data, error } = await supabase
      .from("kanban_columns")
      .insert({
        user_id: user.id,
        title,
        color,
        position: maxPos + 1,
      })
      .select()
      .single()

    if (!error && data) {
      setColumns((prev) => [...prev, { ...data, cards: [] }])
    }
  }

  async function updateColumn(id: string, data: Partial<KanbanColumn>) {
    setColumns((prev) =>
      prev.map((col) => (col.id === id ? { ...col, ...data } : col))
    )

    const supabase = createClient()
    await supabase.from("kanban_columns").update(data).eq("id", id)
  }

  async function deleteColumn(id: string, moveToColumnId?: string) {
    const supabase = createClient()

    if (moveToColumnId) {
      await supabase
        .from("companies")
        .update({ kanban_column_id: moveToColumnId })
        .eq("kanban_column_id", id)
    } else {
      await supabase
        .from("companies")
        .update({ kanban_column_id: null })
        .eq("kanban_column_id", id)
    }

    await supabase.from("kanban_columns").delete().eq("id", id)

    setColumns((prev) => prev.filter((col) => col.id !== id))
    fetchBoard()
  }

  async function addCompanyToBoard(companyId: string, columnId?: string) {
    const targetColumnId = columnId ?? columns[0]?.id
    if (!targetColumnId) return

    const supabase = createClient()

    const { data: company } = await supabase
      .from("companies")
      .select("*")
      .eq("id", companyId)
      .single()

    if (!company) return

    const newPosition = Date.now()
    const updatedCompany = { ...company, kanban_column_id: targetColumnId, kanban_position: newPosition }

    // Optimistic update
    setColumns((prev) =>
      prev.map((col) =>
        col.id === targetColumnId
          ? { ...col, cards: [...col.cards, updatedCompany as Company] }
          : col
      )
    )

    await supabase
      .from("companies")
      .update({ kanban_column_id: targetColumnId, kanban_position: newPosition })
      .eq("id", companyId)
  }

  async function removeCardFromBoard(companyId: string) {
    // Optimistic update
    setColumns((prev) =>
      prev.map((col) => ({
        ...col,
        cards: col.cards.filter((c) => c.id !== companyId),
      }))
    )

    const supabase = createClient()
    await supabase
      .from("companies")
      .update({ kanban_column_id: null, kanban_position: null })
      .eq("id", companyId)
  }

  return {
    columns,
    loading,
    refetch: fetchBoard,
    moveCard,
    reorderColumns,
    addColumn,
    updateColumn,
    deleteColumn,
    addCompanyToBoard,
    removeCardFromBoard,
  }
}
