"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { MoreHorizontal, Pencil, Trash2, GripHorizontal } from "lucide-react"
import type { KanbanColumn } from "@/types/database"

interface KanbanColumnHeaderProps {
  column: KanbanColumn
  cardCount: number
  onRename: (title: string) => void
  onDelete: () => void
  dragHandleProps?: Record<string, unknown>
}

export function KanbanColumnHeader({
  column,
  cardCount,
  onRename,
  onDelete,
  dragHandleProps,
}: KanbanColumnHeaderProps) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(column.title)

  function handleSave() {
    if (title.trim() && title !== column.title) {
      onRename(title.trim())
    } else {
      setTitle(column.title)
    }
    setEditing(false)
  }

  return (
    <div className="flex items-center justify-between px-2 py-2">
      <div className="flex items-center gap-2">
        <button className="cursor-grab text-muted-foreground active:cursor-grabbing" {...dragHandleProps}>
          <GripHorizontal className="h-4 w-4" />
        </button>
        <div
          className="h-3 w-3 rounded-full shrink-0"
          style={{ backgroundColor: column.color }}
        />
        {editing ? (
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleSave}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave()
              if (e.key === "Escape") { setTitle(column.title); setEditing(false) }
            }}
            className="h-6 text-sm font-semibold w-32"
            autoFocus
          />
        ) : (
          <span className="text-sm font-semibold">{column.title}</span>
        )}
        <span className="text-xs text-muted-foreground">({cardCount})</span>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-6 w-6">
            <MoreHorizontal className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <Pencil className="mr-2 h-3 w-3" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem className="text-destructive" onClick={onDelete}>
            <Trash2 className="mr-2 h-3 w-3" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
