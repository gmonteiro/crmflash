"use client"

import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import type { Company } from "@/types/database"
import { Badge } from "@/components/ui/badge"
import { GripVertical, X } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"

interface KanbanCardProps {
  company: Company
  overlay?: boolean
  onRemove?: (id: string) => void
}

export function KanbanCard({ company, overlay, onRemove }: KanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: company.id,
    data: { type: "card", company, columnId: company.kanban_column_id },
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
        "group rounded-md border bg-card p-2 shadow-sm",
        isDragging && "opacity-30",
        overlay && "rotate-2 shadow-lg"
      )}
    >
      <div className="flex items-start gap-1.5">
        <button
          className="mt-0.5 shrink-0 cursor-grab text-muted-foreground opacity-0 group-hover:opacity-100 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <div className="min-w-0 flex-1">
          <Link
            href={`/companies/${company.id}`}
            className="text-sm font-medium leading-tight hover:underline truncate block"
          >
            {company.name}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {company.industry && (
              <Badge variant="outline" className="text-[10px] h-4 px-1">
                {company.industry}
              </Badge>
            )}
            {company.size_tier && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1">
                {company.size_tier}
              </Badge>
            )}
          </div>
        </div>
        {onRemove && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRemove(company.id)
            }}
            className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
