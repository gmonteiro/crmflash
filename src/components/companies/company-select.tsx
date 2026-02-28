"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ChevronsUpDown, Check, Plus } from "lucide-react"
import { cn } from "@/lib/utils"

interface CompanyOption {
  id: string
  name: string
}

interface CompanySelectProps {
  value: string | null
  onSelect: (companyId: string | null, companyName?: string) => void
}

export function CompanySelect({ value, onSelect }: CompanySelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [options, setOptions] = useState<CompanyOption[]>([])
  const [selectedName, setSelectedName] = useState("")

  useEffect(() => {
    if (value) {
      async function load() {
        const supabase = createClient()
        const { data } = await supabase
          .from("companies")
          .select("id, name")
          .eq("id", value)
          .single()
        if (data) setSelectedName(data.name)
      }
      load()
    }
  }, [value])

  useEffect(() => {
    if (!search || search.length < 2) {
      setOptions([])
      return
    }
    async function doSearch() {
      const supabase = createClient()
      const { data } = await supabase
        .from("companies")
        .select("id, name")
        .ilike("name", `%${search}%`)
        .limit(10)
      setOptions(data ?? [])
    }
    doSearch()
  }, [search])

  async function handleCreateNew() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data } = await supabase
      .from("companies")
      .insert({ name: search, user_id: user.id })
      .select("id, name")
      .single()

    if (data) {
      onSelect(data.id, data.name)
      setSelectedName(data.name)
      setOpen(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className="w-full justify-between font-normal"
        >
          {selectedName || "Select company..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-2">
        <Input
          placeholder="Search companies..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-2"
        />
        <div className="max-h-48 overflow-auto">
          <button
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
            onClick={() => {
              onSelect(null)
              setSelectedName("")
              setOpen(false)
            }}
          >
            <span className="text-muted-foreground">None</span>
          </button>
          {options.map((opt) => (
            <button
              key={opt.id}
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
              onClick={() => {
                onSelect(opt.id, opt.name)
                setSelectedName(opt.name)
                setOpen(false)
              }}
            >
              {opt.id === value && <Check className="mr-2 h-4 w-4" />}
              {opt.name}
            </button>
          ))}
          {search.length >= 2 && options.length === 0 && (
            <button
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm text-primary hover:bg-muted"
              onClick={handleCreateNew}
            >
              <Plus className="mr-2 h-4 w-4" />
              Create &quot;{search}&quot;
            </button>
          )}
          {search.length >= 2 && options.length > 0 && (
            <button
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm text-primary hover:bg-muted border-t mt-1 pt-2"
              onClick={handleCreateNew}
            >
              <Plus className="mr-2 h-4 w-4" />
              Create &quot;{search}&quot;
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
