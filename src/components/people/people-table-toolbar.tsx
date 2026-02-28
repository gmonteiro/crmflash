"use client"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Search, Plus, Linkedin } from "lucide-react"

interface PeopleTableToolbarProps {
  search: string
  onSearchChange: (value: string) => void
  category: string
  onCategoryChange: (value: string) => void
  onAddPerson: () => void
  selectedCount?: number
  onBulkEnrich?: () => void
}

export function PeopleTableToolbar({
  search,
  onSearchChange,
  category,
  onCategoryChange,
  onAddPerson,
  selectedCount = 0,
  onBulkEnrich,
}: PeopleTableToolbarProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search contacts..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={category} onValueChange={onCategoryChange}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="Lead">Lead</SelectItem>
            <SelectItem value="Client">Client</SelectItem>
            <SelectItem value="Partner">Partner</SelectItem>
            <SelectItem value="Prospect">Prospect</SelectItem>
            <SelectItem value="Other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        {selectedCount > 0 && onBulkEnrich && (
          <Button variant="outline" size="sm" onClick={onBulkEnrich}>
            <Linkedin className="mr-2 h-4 w-4" />
            Enrich ({selectedCount})
          </Button>
        )}
        <Button onClick={onAddPerson}>
          <Plus className="mr-2 h-4 w-4" />
          Add Person
        </Button>
      </div>
    </div>
  )
}
