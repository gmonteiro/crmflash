"use client"

import { useState, useEffect } from "react"
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
  RowSelectionState,
} from "@tanstack/react-table"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { MoreHorizontal, Eye, Trash2, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react"
import type { Company } from "@/types/database"
import { safeHref } from "@/lib/utils"
import Link from "next/link"

interface CompanyTableProps {
  companies: Company[]
  loading: boolean
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  onDelete: (id: string) => void
  sortBy?: string
  sortDirection?: "asc" | "desc"
  onSortChange: (column: string) => void
  onSelectionChange?: (selectedIds: string[]) => void
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

export function CompanyTable({
  companies,
  loading,
  page,
  pageCount,
  onPageChange,
  onDelete,
  sortBy,
  sortDirection,
  onSortChange,
  onSelectionChange,
}: CompanyTableProps) {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  useEffect(() => {
    if (onSelectionChange) {
      const selectedIds = Object.keys(rowSelection).filter((k) => rowSelection[k])
      onSelectionChange(selectedIds)
    }
  }, [rowSelection, onSelectionChange])

  const columns: ColumnDef<Company>[] = [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
          onClick={(e) => e.stopPropagation()}
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: "name",
      header: () => (
        <SortHeader label="Name" column="name" sortBy={sortBy} sortDirection={sortDirection} onSortChange={onSortChange} />
      ),
      cell: ({ row }) => (
        <Link
          href={`/companies/${row.original.id}`}
          className="font-medium text-primary hover:underline"
        >
          {row.original.name}
        </Link>
      ),
    },
    {
      accessorKey: "industry",
      header: () => (
        <SortHeader label="Industry" column="industry" sortBy={sortBy} sortDirection={sortDirection} onSortChange={onSortChange} />
      ),
      cell: ({ row }) =>
        row.original.industry ? (
          <Badge variant="outline">{row.original.industry}</Badge>
        ) : null,
    },
    {
      accessorKey: "size_tier",
      header: () => (
        <SortHeader label="Size" column="size_tier" sortBy={sortBy} sortDirection={sortDirection} onSortChange={onSortChange} />
      ),
      cell: ({ row }) =>
        row.original.size_tier ? (
          <Badge variant="secondary">{row.original.size_tier}</Badge>
        ) : null,
    },
    {
      accessorKey: "employee_count",
      header: () => (
        <SortHeader label="Employees" column="employee_count" sortBy={sortBy} sortDirection={sortDirection} onSortChange={onSortChange} />
      ),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.employee_count?.toLocaleString() || "-"}
        </span>
      ),
    },
    {
      accessorKey: "website",
      header: "Website",
      cell: ({ row }) =>
        safeHref(row.original.website) ? (
          <a
            href={safeHref(row.original.website)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline"
          >
            {row.original.domain || (() => { try { return new URL(row.original.website!).hostname } catch { return row.original.website } })()}
          </a>
        ) : null,
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/companies/${row.original.id}`}>
                <Eye className="mr-2 h-4 w-4" />
                View Details
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => onDelete(row.original.id)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  const table = useReactTable({
    data: companies,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    onRowSelectionChange: setRowSelection,
    state: { rowSelection },
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
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  No companies found.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
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
            <Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={page === 0}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount - 1}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
