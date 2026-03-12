"use client"

import { useEffect, useState } from "react"
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  RowSelectionState,
} from "@tanstack/react-table"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { getPeopleColumns } from "./people-table-columns"
import type { Person } from "@/types/database"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight } from "lucide-react"

interface PeopleTableProps {
  people: Person[]
  loading: boolean
  page: number
  totalPages: number
  totalCount: number
  onPageChange: (page: number) => void
  onUpdate: (id: string, data: Partial<Person>) => void
  onDelete: (id: string) => void
  sortBy?: string
  sortDirection?: "asc" | "desc"
  onSortChange: (column: string) => void
  onSelectionChange?: (selectedIds: string[]) => void
  shortlistsByPerson?: Record<string, { id: string; name: string }[]>
}

export function PeopleTable({
  people,
  loading,
  page,
  totalPages,
  totalCount,
  onPageChange,
  onUpdate,
  onDelete,
  sortBy,
  sortDirection,
  onSortChange,
  onSelectionChange,
  shortlistsByPerson,
}: PeopleTableProps) {
  const router = useRouter()
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const columns = getPeopleColumns({ onUpdate, onDelete, sortBy, sortDirection, onSortChange, shortlistsByPerson })

  const table = useReactTable({
    data: people,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    onRowSelectionChange: setRowSelection,
    state: { rowSelection },
  })

  // Clear selection on page change
  useEffect(() => {
    setRowSelection({})
  }, [page])

  // Notify parent of selection changes
  useEffect(() => {
    if (onSelectionChange) {
      const selectedIds = Object.keys(rowSelection).filter((k) => rowSelection[k])
      onSelectionChange(selectedIds)
    }
  }, [rowSelection, onSelectionChange])

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
    <div className="space-y-4">
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

      {/* Pagination controls */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {totalCount} contact{totalCount !== 1 ? "s" : ""} total
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page - 1)}
            disabled={page === 0}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages - 1}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
