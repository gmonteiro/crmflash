"use client"

import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import type { Person } from "@/types/database"
import { Badge } from "@/components/ui/badge"
import { GripVertical, Mail } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"

interface KanbanCardProps {
  person: Person
  overlay?: boolean
}

export function KanbanCard({ person, overlay }: KanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: person.id,
    data: { type: "card", person, columnId: person.kanban_column_id },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={!overlay ? setNodeRef : undefined}
      style={!overlay ? style : undefined}
      className={cn(
        "group rounded-md border bg-card p-3 shadow-sm",
        isDragging && "opacity-30",
        overlay && "rotate-2 shadow-lg"
      )}
    >
      <div className="flex items-start gap-2">
        <button
          className="mt-0.5 shrink-0 cursor-grab text-muted-foreground opacity-0 group-hover:opacity-100 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <Link
            href={`/people/${person.id}`}
            className="text-sm font-medium hover:underline"
          >
            {person.full_name}
          </Link>
          {person.current_title && (
            <p className="text-xs text-muted-foreground truncate">
              {person.current_title}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {person.current_company && (
              <Badge variant="outline" className="text-[10px] h-5">
                {person.current_company}
              </Badge>
            )}
            {person.email && (
              <Mail className="h-3 w-3 text-muted-foreground" />
            )}
            {person.category && (
              <Badge variant="secondary" className="text-[10px] h-5">
                {person.category}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
