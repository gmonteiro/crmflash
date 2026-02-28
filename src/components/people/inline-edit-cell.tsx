"use client"

import { useState, useRef, useEffect } from "react"
import { Input } from "@/components/ui/input"

interface InlineEditCellProps {
  value: string
  onSave: (value: string) => void
}

export function InlineEditCell({ value, onSave }: InlineEditCellProps) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  function handleSave() {
    if (editValue !== value) {
      onSave(editValue)
    }
    setEditing(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSave()
    if (e.key === "Escape") {
      setEditValue(value)
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className="h-7 text-sm"
      />
    )
  }

  return (
    <span
      className="cursor-pointer rounded px-1 py-0.5 hover:bg-muted"
      onDoubleClick={() => setEditing(true)}
      title="Double-click to edit"
    >
      {value || <span className="text-muted-foreground italic">-</span>}
    </span>
  )
}
