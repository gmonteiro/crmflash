"use client"

import {
  useReactTable,
  getCoreRowModel,
  flexRender,
} from "@tanstack/react-table"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { getPeopleColumns } from "./people-table-columns"
import type { Person } from "@/types/database"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useRouter } from "next/navigation"

interface PeopleTableProps {
  people: Person[]
  loading: boolean
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  onUpdate: (id: string, data: Partial<Person>) => void
  onDelete: (id: string) => void
  sortBy?: string
  sortDirection?: "asc" | "desc"
  onSortChange: (column: string) => void
}

export function PeopleTable({
  people,
  loading,
  page,
  pageCount,
  onPageChange,
  onUpdate,
  onDelete,
  sortBy,
  sortDirection,
  onSortChange,
}: PeopleTableProps) {
  const router = useRouter()
  const columns = getPeopleColumns({ onUpdate, onDelete, sortBy, sortDirection, onSortChange })

  const table = useReactTable({
    data: people,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  No contacts found.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/people/${row.original.id}`)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} onClick={(e) => {
                      // Prevent row navigation for interactive cells (inline edit, actions, links)
                      const target = e.target as HTMLElement
                      if (
                        target.closest("input") ||
                        target.closest("button") ||
                        target.closest("a") ||
                        target.closest("[role='menu']") ||
                        target.closest("[data-stop-propagation]")
                      ) {
                        e.stopPropagation()
                      }
                    }}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-muted-foreground">
            Page {page + 1} of {pageCount}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(page - 1)}
              disabled={page === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= pageCount - 1}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
