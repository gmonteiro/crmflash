"use client"

import { useState, useCallback } from "react"
import { useShortlists } from "@/hooks/use-shortlists"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardAction } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { MoreHorizontal, Pencil, Trash2, X, ListPlus, ChevronDown, ChevronUp, Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { ShortlistEntityType, ShortlistMember } from "@/types/database"

interface ShortlistsTabProps {
  entityType: ShortlistEntityType
}

export function ShortlistsTab({ entityType }: ShortlistsTabProps) {
  const {
    shortlists,
    loading,
    updateShortlist,
    deleteShortlist,
    removeMember,
    fetchMembers,
  } = useShortlists(entityType)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [members, setMembers] = useState<ShortlistMember[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")

  const handleExpand = useCallback(async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null)
      setMembers([])
      return
    }
    setExpandedId(id)
    setMembersLoading(true)
    const m = await fetchMembers(id)
    setMembers(m)
    setMembersLoading(false)
  }, [expandedId, fetchMembers])

  const handleDelete = useCallback(async (id: string) => {
    const ok = await deleteShortlist(id)
    if (ok) {
      toast.success("Shortlist deleted")
      if (expandedId === id) {
        setExpandedId(null)
        setMembers([])
      }
    } else {
      toast.error("Failed to delete shortlist")
    }
  }, [deleteShortlist, expandedId])

  const handleRename = useCallback(async (id: string) => {
    if (!renameValue.trim()) return
    const ok = await updateShortlist(id, { name: renameValue.trim() })
    if (ok) toast.success("Shortlist renamed")
    else toast.error("Failed to rename")
    setRenamingId(null)
    setRenameValue("")
  }, [updateShortlist, renameValue])

  const handleRemoveMember = useCallback(async (memberId: string) => {
    if (!expandedId) return
    const ok = await removeMember(memberId, expandedId)
    if (ok) {
      setMembers((prev) => prev.filter((m) => m.id !== memberId))
      toast.success("Removed from shortlist")
    } else {
      toast.error("Failed to remove")
    }
  }, [removeMember, expandedId])

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    )
  }

  if (shortlists.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <ListPlus className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-medium mb-1">No shortlists yet</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Select {entityType === "person" ? "contacts" : "companies"} from the main list using the checkboxes,
          then click &quot;Add to Shortlist&quot; to create one.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shortlists.map((sl) => (
          <Card
            key={sl.id}
            className={`cursor-pointer transition-colors hover:border-primary/30 ${expandedId === sl.id ? "border-primary/50" : ""}`}
            onClick={() => handleExpand(sl.id)}
          >
            <CardHeader>
              {renamingId === sl.id ? (
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename(sl.id)
                      if (e.key === "Escape") setRenamingId(null)
                    }}
                    className="h-8 text-sm"
                    autoFocus
                  />
                  <Button size="sm" variant="ghost" onClick={() => handleRename(sl.id)}>
                    Save
                  </Button>
                </div>
              ) : (
                <CardTitle className="text-base">{sl.name}</CardTitle>
              )}
              <CardDescription>
                <Badge variant="secondary" className="text-xs">
                  {sl.member_count ?? 0} {entityType === "person" ? "contact" : "company"}{(sl.member_count ?? 0) !== 1 ? (entityType === "person" ? "s" : "ies") : (entityType === "company" ? "y" : "")}
                </Badge>
              </CardDescription>
              <CardAction>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={(e) => {
                      e.stopPropagation()
                      setRenamingId(sl.id)
                      setRenameValue(sl.name)
                    }}>
                      <Pencil className="mr-2 h-4 w-4" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(sl.id)
                      }}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardAction>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex items-center justify-center text-xs text-muted-foreground">
                {expandedId === sl.id ? (
                  <><ChevronUp className="h-3 w-3 mr-1" /> Collapse</>
                ) : (
                  <><ChevronDown className="h-3 w-3 mr-1" /> View members</>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {expandedId && (
        <div className="rounded-md border">
          {membersLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : members.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No members in this shortlist yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {entityType === "person" ? (
                    <>
                      <TableHead>Name</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Email</TableHead>
                    </>
                  ) : (
                    <>
                      <TableHead>Name</TableHead>
                      <TableHead>Industry</TableHead>
                      <TableHead>Size</TableHead>
                    </>
                  )}
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    {entityType === "person" && m.person ? (
                      <>
                        <TableCell className="font-medium">{m.person.full_name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{(m.person as { current_title?: string }).current_title || "-"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{(m.person as { current_company?: string }).current_company || "-"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{(m.person as { email?: string }).email || "-"}</TableCell>
                      </>
                    ) : entityType === "company" && m.company ? (
                      <>
                        <TableCell className="font-medium">{m.company.name}</TableCell>
                        <TableCell>
                          {(m.company as { industry?: string }).industry ? (
                            <Badge variant="outline">{(m.company as { industry?: string }).industry}</Badge>
                          ) : "-"}
                        </TableCell>
                        <TableCell>
                          {(m.company as { size_tier?: string }).size_tier ? (
                            <Badge variant="secondary">{(m.company as { size_tier?: string }).size_tier}</Badge>
                          ) : "-"}
                        </TableCell>
                      </>
                    ) : (
                      <TableCell colSpan={entityType === "person" ? 4 : 3} className="text-muted-foreground">
                        Deleted
                      </TableCell>
                    )}
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemoveMember(m.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </div>
  )
}
