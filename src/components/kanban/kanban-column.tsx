"use client"

import { useSortable } from "@dnd-kit/sortable"
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { useDroppable } from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import { KanbanCard } from "./kanban-card"
import { KanbanColumnHeader } from "./kanban-column-header"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { KanbanColumnWithCards } from "@/types/kanban"
import { cn } from "@/lib/utils"

interface KanbanColumnProps {
  column: KanbanColumnWithCards
  onRename: (title: string) => void
  onDelete: () => void
}

export function KanbanColumnComponent({ column, onRename, onDelete }: KanbanColumnProps) {
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: column.id,
    data: { type: "column", column },
  })

  const { setNodeRef: setDroppableRef } = useDroppable({
    id: `column-${column.id}`,
    data: { type: "column", columnId: column.id },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const cardIds = column.cards.map((c) => c.id)

  return (
    <div
      ref={setSortableRef}
      style={style}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-lg border bg-muted/30",
        isDragging && "opacity-50"
      )}
    >
      <KanbanColumnHeader
        column={column}
        cardCount={column.cards.length}
        onRename={onRename}
        onDelete={onDelete}
        dragHandleProps={{ ...attributes, ...listeners }}
      />

      <div ref={setDroppableRef} className="flex-1 min-h-[100px]">
        <ScrollArea className="h-[calc(100vh-250px)]">
          <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-2 p-2">
              {column.cards.map((person) => (
                <KanbanCard key={person.id} person={person} />
              ))}
            </div>
          </SortableContext>
        </ScrollArea>
      </div>
    </div>
  )
}
