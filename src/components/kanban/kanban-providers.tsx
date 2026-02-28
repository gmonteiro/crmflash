"use client"

import { DndContext, DragOverlay, closestCorners, type DragStartEvent, type DragEndEvent, type DragOverEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core"
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable"
import { useState, type ReactNode } from "react"
import type { Person, KanbanColumn } from "@/types/database"
import { KanbanCard } from "./kanban-card"

interface KanbanProvidersProps {
  columnIds: string[]
  onDragEnd: (event: DragEndEvent) => void
  onDragOver: (event: DragOverEvent) => void
  children: ReactNode
}

export function KanbanProviders({
  columnIds,
  onDragEnd,
  onDragOver,
  children,
}: KanbanProvidersProps) {
  const [activeCard, setActiveCard] = useState<Person | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  )

  function handleDragStart(event: DragStartEvent) {
    const { active } = event
    if (active.data.current?.type === "card") {
      setActiveCard(active.data.current.person as Person)
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null)
    onDragEnd(event)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={onDragOver}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
        {children}
      </SortableContext>
      <DragOverlay>
        {activeCard && <KanbanCard person={activeCard} overlay />}
      </DragOverlay>
    </DndContext>
  )
}
