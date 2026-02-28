"use client"

import { useCallback } from "react"
import type { DragEndEvent, DragOverEvent } from "@dnd-kit/core"
import { useKanban } from "@/hooks/use-kanban"
import { KanbanProviders } from "./kanban-providers"
import { KanbanColumnComponent } from "./kanban-column"
import { AddColumnDialog } from "./add-column-dialog"
import { AddPersonDialog } from "./add-person-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"

export function KanbanBoard() {
  const {
    columns,
    loading,
    moveCard,
    reorderColumns,
    addColumn,
    updateColumn,
    deleteColumn,
    addPersonToBoard,
  } = useKanban()

  const handleDragOver = useCallback((event: DragOverEvent) => {
    // Handled in drag end for simplicity
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over) return

      const activeData = active.data.current
      const overData = over.data.current

      if (!activeData) return

      // Card dropped
      if (activeData.type === "card") {
        let targetColumnId: string
        let targetIndex: number

        if (overData?.type === "card") {
          // Dropped on another card
          targetColumnId = overData.columnId as string
          const targetCol = columns.find((c) => c.id === targetColumnId)
          targetIndex = targetCol?.cards.findIndex((c) => c.id === over.id) ?? 0
        } else if (overData?.type === "column") {
          // Dropped on column droppable area
          targetColumnId = overData.columnId as string
          const targetCol = columns.find((c) => c.id === targetColumnId)
          targetIndex = targetCol?.cards.length ?? 0
        } else {
          // Dropped on column sortable
          const colId = String(over.id).replace("column-", "")
          const targetCol = columns.find((c) => c.id === colId || c.id === String(over.id))
          if (!targetCol) return
          targetColumnId = targetCol.id
          targetIndex = targetCol.cards.length
        }

        moveCard(String(active.id), targetColumnId, targetIndex)
        return
      }

      // Column reorder
      if (activeData.type === "column" && active.id !== over.id) {
        const overIndex = columns.findIndex((c) => c.id === String(over.id))
        if (overIndex !== -1) {
          reorderColumns(String(active.id), overIndex)
        }
      }
    },
    [columns, moveCard, reorderColumns]
  )

  if (loading) {
    return (
      <div className="flex gap-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-96 w-72 shrink-0" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      <KanbanProviders
        columnIds={columns.map((c) => c.id)}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
      >
        {columns.map((column) => (
          <KanbanColumnComponent
            key={column.id}
            column={column}
            onRename={(title) => updateColumn(column.id, { title })}
            onDelete={() => {
              if (column.cards.length > 0) {
                const firstOther = columns.find((c) => c.id !== column.id)
                deleteColumn(column.id, firstOther?.id)
              } else {
                deleteColumn(column.id)
              }
              toast.success("Column deleted")
            }}
          />
        ))}
      </KanbanProviders>
      <AddPersonDialog columns={columns} onAdd={addPersonToBoard} />
      <AddColumnDialog onAdd={addColumn} />
    </div>
  )
}
