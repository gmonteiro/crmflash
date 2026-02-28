"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Building2, Search, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { createClient } from "@/lib/supabase/client"
import type { Company, KanbanColumn } from "@/types/database"

interface AddCompanyDialogProps {
  columns: KanbanColumn[]
  onAdd: (companyId: string, columnId?: string) => Promise<void>
}

export function AddCompanyDialog({ columns, onAdd }: AddCompanyDialogProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [columnId, setColumnId] = useState<string>("")
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setSearch("")
      setCompanies([])
      setColumnId("")
      return
    }
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
        .from("companies")
        .select("id, name, industry, size_tier")
        .is("kanban_column_id", null)
        .order("name")
        .limit(20)

      if (search.trim()) {
        query = query.ilike("name", `%${search.trim()}%`)
      }

      const { data } = await query
      setCompanies((data ?? []) as Company[])
      setLoading(false)
    }, 300)

    return () => clearTimeout(timer)
  }, [open, search])

  async function handleAdd(companyId: string) {
    setAdding(companyId)
    await onAdd(companyId, columnId || undefined)
    setCompanies((prev) => prev.filter((c) => c.id !== companyId))
    setAdding(null)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-10 shrink-0">
          <Building2 className="mr-2 h-4 w-4" />
          Add Company
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Company to Board</DialogTitle>
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
            <Label>Search Companies</Label>
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
            ) : companies.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No companies available to add.
              </p>
            ) : (
              companies.map((company) => (
                <button
                  key={company.id}
                  onClick={() => handleAdd(company.id)}
                  disabled={adding === company.id}
                  className="flex w-full items-center justify-between rounded-md border p-2.5 text-left hover:bg-muted disabled:opacity-50"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{company.name}</p>
                    <div className="flex items-center gap-1 mt-0.5">
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
                  {adding === company.id ? (
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  ) : (
                    <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
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
