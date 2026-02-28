"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Person } from "@/types/database"
import { InlineEditCell } from "./inline-edit-cell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { MoreHorizontal, ExternalLink, Trash2, Eye } from "lucide-react"
import Link from "next/link"

interface ColumnOptions {
  onUpdate: (id: string, data: Partial<Person>) => void
  onDelete: (id: string) => void
}

export function getPeopleColumns({ onUpdate, onDelete }: ColumnOptions): ColumnDef<Person>[] {
  return [
    {
      accessorKey: "full_name",
      header: "Name",
      cell: ({ row }) => {
        const person = row.original
        return (
          <div className="flex items-center gap-2">
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
      header: "Title",
      cell: ({ row }) => (
        <InlineEditCell
          value={row.original.current_title || ""}
          onSave={(val) => onUpdate(row.original.id, { current_title: val })}
        />
      ),
    },
    {
      accessorKey: "current_company",
      header: "Company",
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
          <InlineEditCell
            value={row.original.current_company || ""}
            onSave={(val) => onUpdate(row.original.id, { current_company: val })}
          />
        )
      },
    },
    {
      accessorKey: "category",
      header: "Category",
      cell: ({ row }) => {
        const cat = row.original.category
        return cat ? <Badge variant="secondary">{cat}</Badge> : null
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
              {person.linkedin_url && (
                <DropdownMenuItem asChild>
                  <a href={person.linkedin_url} target="_blank" rel="noopener noreferrer">
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
