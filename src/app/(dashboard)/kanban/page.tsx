"use client"

import { KanbanBoard } from "@/components/kanban/kanban-board"

export default function KanbanPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Kanban Board</h1>
      <KanbanBoard />
    </div>
  )
}
