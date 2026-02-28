"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { UserPlus, Search, Loader2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import type { Person, KanbanColumn } from "@/types/database"

interface AddPersonDialogProps {
  columns: KanbanColumn[]
  onAdd: (personId: string, columnId?: string) => Promise<void>
}

export function AddPersonDialog({ columns, onAdd }: AddPersonDialogProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [columnId, setColumnId] = useState<string>("")
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setSearch("")
      setPeople([])
      setColumnId("")
      return
    }
    // Set default column
    if (columns.length > 0 && !columnId) {
      setColumnId(columns[0].id)
    }
  }, [open, columns, columnId])

  useEffect(() => {
    if (!open) return

    const timer = setTimeout(async () => {
      setLoading(true)
      const supabase = createClient()

      let query = supabase
        .from("people")
        .select("id, first_name, last_name, full_name, email, current_title")
        .is("kanban_column_id", null)
        .order("full_name")
        .limit(20)

      if (search.trim()) {
        query = query.ilike("full_name", `%${search.trim()}%`)
      }

      const { data } = await query
      setPeople((data ?? []) as Person[])
      setLoading(false)
    }, 300)

    return () => clearTimeout(timer)
  }, [open, search])

  async function handleAdd(personId: string) {
    setAdding(personId)
    await onAdd(personId, columnId || undefined)
    setPeople((prev) => prev.filter((p) => p.id !== personId))
    setAdding(null)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-10 shrink-0">
          <UserPlus className="mr-2 h-4 w-4" />
          Add Person
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Person to Board</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Column</Label>
            <Select value={columnId} onValueChange={setColumnId}>
              <SelectTrigger>
                <SelectValue placeholder="Select column" />
              </SelectTrigger>
              <SelectContent>
                {columns.map((col) => (
                  <SelectItem key={col.id} value={col.id}>
                    {col.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Search People</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name..."
                className="pl-9"
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {loading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : people.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No people available to add.
              </p>
            ) : (
              people.map((person) => (
                <button
                  key={person.id}
                  onClick={() => handleAdd(person.id)}
                  disabled={adding === person.id}
                  className="flex w-full items-center justify-between rounded-md border p-2.5 text-left hover:bg-muted disabled:opacity-50"
                >
                  <div>
                    <p className="text-sm font-medium">{person.full_name}</p>
                    {person.current_title && (
                      <p className="text-xs text-muted-foreground">{person.current_title}</p>
                    )}
                  </div>
                  {adding === person.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
