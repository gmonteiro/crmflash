"use client"

import { useRef, useEffect, useCallback, useState } from "react"
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  RowSelectionState,
} from "@tanstack/react-table"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { getPeopleColumns } from "./people-table-columns"
import type { Person } from "@/types/database"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"

interface PeopleTableProps {
  people: Person[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  onLoadMore: () => void
  onUpdate: (id: string, data: Partial<Person>) => void
  onDelete: (id: string) => void
  sortBy?: string
  sortDirection?: "asc" | "desc"
  onSortChange: (column: string) => void
  onSelectionChange?: (selectedIds: string[]) => void
}

export function PeopleTable({
  people,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  onUpdate,
  onDelete,
  sortBy,
  sortDirection,
  onSortChange,
  onSelectionChange,
}: PeopleTableProps) {
  const router = useRouter()
  const sentinelRef = useRef<HTMLTableRowElement>(null)
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const columns = getPeopleColumns({ onUpdate, onDelete, sortBy, sortDirection, onSortChange })

  const table = useReactTable({
    data: people,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    onRowSelectionChange: setRowSelection,
    state: { rowSelection },
  })

  // Notify parent of selection changes
  useEffect(() => {
    if (onSelectionChange) {
      const selectedIds = Object.keys(rowSelection).filter((k) => rowSelection[k])
      onSelectionChange(selectedIds)
    }
  }, [rowSelection, onSelectionChange])

  // Intersection observer to trigger loadMore when sentinel is visible
  const onLoadMoreRef = useRef(onLoadMore)
  onLoadMoreRef.current = onLoadMore

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onLoadMoreRef.current()
        }
      },
      { rootMargin: "200px" }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, people.length])

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
              <>
                {table.getRowModel().rows.map((row) => (
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
                ))}
                {hasMore && (
                  <TableRow ref={sentinelRef}>
                    <TableCell colSpan={columns.length} className="h-12 text-center">
                      {loadingMore && (
                        <Loader2 className="h-4 w-4 animate-spin inline-block text-muted-foreground" />
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
