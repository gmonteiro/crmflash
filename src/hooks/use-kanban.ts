"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import type { KanbanColumn, Person } from "@/types/database"
import type { KanbanColumnWithCards } from "@/types/kanban"
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

    const { data: people } = await supabase
      .from("people")
      .select("*, company:companies(id, name)")
      .not("kanban_column_id", "is", null)
      .order("kanban_position")

    const columnsWithCards: KanbanColumnWithCards[] = (cols as KanbanColumn[]).map((col) => ({
      ...col,
      cards: ((people ?? []) as Person[]).filter((p: Person) => p.kanban_column_id === col.id),
    }))

    setColumns(columnsWithCards)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchBoard()
  }, [fetchBoard])

  async function moveCard(
    personId: string,
    targetColumnId: string,
    targetIndex: number
  ) {
    const targetCol = columns.find((c) => c.id === targetColumnId)
    if (!targetCol) return

    const cards = targetCol.cards.filter((c) => c.id !== personId)
    const newPosition = calculatePosition(cards, targetIndex)

    // Optimistic update
    setColumns((prev) =>
      prev.map((col) => {
        const filteredCards = col.cards.filter((c) => c.id !== personId)
        if (col.id === targetColumnId) {
          const movedCard = prev
            .flatMap((c) => c.cards)
            .find((c) => c.id === personId)
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
    await supabase
      .from("people")
      .update({
        kanban_column_id: targetColumnId,
        kanban_position: newPosition,
      })
      .eq("id", personId)
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
        .from("people")
        .update({ kanban_column_id: moveToColumnId })
        .eq("kanban_column_id", id)
    } else {
      await supabase
        .from("people")
        .update({ kanban_column_id: null })
        .eq("kanban_column_id", id)
    }

    await supabase.from("kanban_columns").delete().eq("id", id)

    setColumns((prev) => prev.filter((col) => col.id !== id))
    fetchBoard()
  }

  async function addPersonToBoard(personId: string, columnId?: string) {
    const targetColumnId = columnId ?? columns[0]?.id
    if (!targetColumnId) return

    const supabase = createClient()

    // Fetch the person to add to optimistic state
    const { data: person } = await supabase
      .from("people")
      .select("*, company:companies(id, name)")
      .eq("id", personId)
      .single()

    if (!person) return

    const newPosition = Date.now()
    const updatedPerson = { ...person, kanban_column_id: targetColumnId, kanban_position: newPosition }

    // Optimistic update
    setColumns((prev) =>
      prev.map((col) =>
        col.id === targetColumnId
          ? { ...col, cards: [...col.cards, updatedPerson as Person] }
          : col
      )
    )

    await supabase
      .from("people")
      .update({ kanban_column_id: targetColumnId, kanban_position: newPosition })
      .eq("id", personId)
  }

  async function removePersonFromBoard(personId: string) {
    // Optimistic update
    setColumns((prev) =>
      prev.map((col) => ({
        ...col,
        cards: col.cards.filter((c) => c.id !== personId),
      }))
    )

    const supabase = createClient()
    await supabase
      .from("people")
      .update({ kanban_column_id: null, kanban_position: null })
      .eq("id", personId)
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
    addPersonToBoard,
    removePersonFromBoard,
  }
}
