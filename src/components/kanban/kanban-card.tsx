"use client"

import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import type { KanbanCardCompany } from "@/types/kanban"
import { Badge } from "@/components/ui/badge"
import { GripVertical, X, User, Zap, CalendarClock, AlertTriangle } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { clientEventStatus } from "@/lib/pipeline/health"
import { parseISO, format } from "date-fns"

interface KanbanCardProps {
  company: KanbanCardCompany
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

  // Mesma regra de "conta parada" do dashboard e do copiloto (health.ts).
  const event = clientEventStatus(company.last_client_event_at)
  const signalCount = company.signalCount ?? 0

  return (
    <div
      ref={!overlay ? setNodeRef : undefined}
      style={!overlay ? style : undefined}
      className={cn(
        "group overflow-hidden rounded-md border border-l-2 bg-card p-2 shadow-sm",
        event.health === "frozen" && "border-l-red-500",
        event.health === "stale" && "border-l-amber-500",
        event.health === "fresh" && "border-l-emerald-500",
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
            className="block truncate text-sm font-medium leading-tight hover:underline"
            title={company.name}
          >
            {company.name}
          </Link>

          {company.champion_name && (
            <div className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <User className="h-3 w-3 shrink-0" />
              <span className="truncate" title={company.champion_name}>
                {company.champion_name}
              </span>
            </div>
          )}

          {/* O Badge do shadcn nasce com shrink-0 + whitespace-nowrap: um setor de
              nome comprido se recusa a encolher, estoura a largura da coluna e o
              ScrollArea (que só tem barra vertical) corta o resto. max-w-full o
              prende na coluna e o span trunca com reticências; o title mostra o
              valor inteiro no hover. */}
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
            {company.industry && (
              <Badge
                variant="outline"
                className="h-4 min-w-0 max-w-full px-1 text-[10px]"
                title={company.industry}
              >
                <span className="truncate">{company.industry}</span>
              </Badge>
            )}
            {company.size_tier && (
              <Badge
                variant="secondary"
                className="h-4 min-w-0 max-w-full px-1 text-[10px]"
                title={company.size_tier}
              >
                <span className="truncate">{company.size_tier}</span>
              </Badge>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
            <span className={cn("flex items-center gap-0.5 font-medium", event.colorClass)}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {event.label}
            </span>
            {signalCount > 0 && (
              <span className="flex items-center gap-0.5 text-violet-600 dark:text-violet-400 font-medium">
                <Zap className="h-3 w-3" />
                {signalCount}
              </span>
            )}
            {company.nextStepDue ? (
              <span className="flex items-center gap-0.5 text-muted-foreground">
                <CalendarClock className="h-3 w-3" />
                {format(parseISO(company.nextStepDue), "dd/MM")}
              </span>
            ) : (
              <span className="flex items-center gap-0.5 text-red-600 dark:text-red-400">
                <AlertTriangle className="h-3 w-3" />
                sem próximo passo
              </span>
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
