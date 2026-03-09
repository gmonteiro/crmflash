"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Person } from "@/types/database"
import { InlineEditCell } from "./inline-edit-cell"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { MoreHorizontal, ExternalLink, Trash2, Eye, ArrowUpDown, ArrowUp, ArrowDown, Linkedin } from "lucide-react"
import Link from "next/link"
import { safeHref } from "@/lib/utils"

interface ColumnOptions {
  onUpdate: (id: string, data: Partial<Person>) => void
  onDelete: (id: string) => void
  sortBy?: string
  sortDirection?: "asc" | "desc"
  onSortChange: (column: string) => void
}

function SortHeader({
  label,
  column,
  sortBy,
  sortDirection,
  onSortChange,
}: {
  label: string
  column: string
  sortBy?: string
  sortDirection?: "asc" | "desc"
  onSortChange: (column: string) => void
}) {
  const active = sortBy === column
  const Icon = active ? (sortDirection === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 h-8"
      onClick={() => onSortChange(column)}
    >
      {label}
      <Icon className="ml-1 h-3.5 w-3.5" />
    </Button>
  )
}

export function getPeopleColumns({ onUpdate, onDelete, sortBy, sortDirection, onSortChange }: ColumnOptions): ColumnDef<Person>[] {
  return [
    {
      id: "select",
      header: ({ table }) => (
        <div data-stop-propagation>
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label="Select all"
          />
        </div>
      ),
      cell: ({ row }) => (
        <div data-stop-propagation>
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: "full_name",
      header: () => (
        <SortHeader label="Name" column="full_name" sortBy={sortBy} sortDirection={sortDirection} onSortChange={onSortChange} />
      ),
      cell: ({ row }) => {
        const person = row.original
        return (
          <div className="flex items-center gap-2" data-stop-propagation>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              {person.first_name?.[0]}{person.last_name?.[0]}
            </div>
            <div className="min-w-0">
              <InlineEditCell
                value={person.full_name}
                onSave={(val) => {
                  const parts = val.split(" ")
                  const first_name = parts[0] || ""
                  const last_name = parts.slice(1).join(" ") || ""
                  onUpdate(person.id, { first_name, last_name })
                }}
              />
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: "current_title",
      header: () => (
        <SortHeader label="Title" column="current_title" sortBy={sortBy} sortDirection={sortDirection} onSortChange={onSortChange} />
      ),
      cell: ({ row }) => (
        <div data-stop-propagation>
          <InlineEditCell
            value={row.original.current_title || ""}
            onSave={(val) => onUpdate(row.original.id, { current_title: val })}
          />
        </div>
      ),
    },
    {
      accessorKey: "current_company",
      header: () => (
        <SortHeader label="Company" column="current_company" sortBy={sortBy} sortDirection={sortDirection} onSortChange={onSortChange} />
      ),
      cell: ({ row }) => {
        const company = row.original.company
        if (company) {
          return (
            <Link
              href={`/companies/${company.id}`}
              className="text-sm text-primary hover:underline"
            >
              {company.name}
            </Link>
          )
        }
        return (
          <div data-stop-propagation>
            <InlineEditCell
              value={row.original.current_company || ""}
              onSave={(val) => onUpdate(row.original.id, { current_company: val })}
            />
          </div>
        )
      },
    },
    {
      id: "linkedin",
      header: "LinkedIn",
      cell: ({ row }) => {
        const url = safeHref(row.original.linkedin_url)
        if (!url) return <span className="text-sm text-muted-foreground">-</span>
        return (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-muted-foreground hover:text-primary"
            onClick={(e) => e.stopPropagation()}
          >
            <Linkedin className="h-4 w-4" />
          </a>
        )
      },
    },
    {
      accessorKey: "email",
      header: "Email",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.email || "-"}</span>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const person = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/people/${person.id}`}>
                  <Eye className="mr-2 h-4 w-4" />
                  View Details
                </Link>
              </DropdownMenuItem>
              {safeHref(person.linkedin_url) && (
                <DropdownMenuItem asChild>
                  <a href={safeHref(person.linkedin_url)!} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    LinkedIn
                  </a>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => onDelete(person.id)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]
}
