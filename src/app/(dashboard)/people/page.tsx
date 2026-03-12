"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { usePeople } from "@/hooks/use-people"
import { useShortlists, useShortlistMemberships } from "@/hooks/use-shortlists"
import { PeopleTable } from "@/components/people/people-table"
import { PeopleTableToolbar } from "@/components/people/people-table-toolbar"
import { PersonForm } from "@/components/people/person-form"
import { AddToShortlistDialog } from "@/components/shared/add-to-shortlist-dialog"
import { ShortlistsTab } from "@/components/shared/shortlists-tab"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import type { PersonFormData } from "@/lib/validators"
import { toast } from "sonner"

export default function PeoplePage() {
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("all")
  const [formOpen, setFormOpen] = useState(false)
  const [sortBy, setSortBy] = useState<string>("created_at")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [shortlistDialogOpen, setShortlistDialogOpen] = useState(false)

  const { shortlistsByEntity, refetch: refetchMemberships } = useShortlistMemberships("person")
  const { shortlists, addMembers } = useShortlists("person")

  const { people, totalCount, loading, page, totalPages, goToPage, createPerson, updatePerson, deletePerson } = usePeople({
    search: search || undefined,
    category: category !== "all" ? category : undefined,
    sortBy,
    sortDesc: sortDirection === "desc",
  })

  // Auto-add to first shortlist when selecting checkboxes
  const prevSelectedRef = useRef<string[]>([])

  useEffect(() => {
    const prev = new Set(prevSelectedRef.current)
    const newlySelected = selectedIds.filter((id) => !prev.has(id))
    prevSelectedRef.current = selectedIds

    if (newlySelected.length === 0 || shortlists.length === 0) return

    const firstShortlist = shortlists[shortlists.length - 1] // oldest = first created
    addMembers(firstShortlist.id, newlySelected).then((ok) => {
      if (ok) {
        toast.success(`Added to "${firstShortlist.name}"`)
        refetchMemberships()
      }
    })
  }, [selectedIds, shortlists, addMembers, refetchMemberships])

  const handleCreate = useCallback(async (data: PersonFormData) => {
    const person = await createPerson(data)
    if (person) {
      toast.success("Contact created")
    } else {
      toast.error("Failed to create contact")
    }
  }, [createPerson])

  const handleUpdate = useCallback(async (id: string, data: Record<string, unknown>) => {
    const success = await updatePerson(id, data)
    if (!success) toast.error("Failed to update")
  }, [updatePerson])

  const handleDelete = useCallback(async (id: string) => {
    const success = await deletePerson(id)
    if (success) toast.success("Contact deleted")
    else toast.error("Failed to delete")
  }, [deletePerson])

  const handleSortChange = useCallback((column: string) => {
    if (column === sortBy) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"))
    } else {
      setSortBy(column)
      setSortDirection("asc")
    }
  }, [sortBy])

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">People</h1>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All People</TabsTrigger>
          <TabsTrigger value="shortlists">Shortlists</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-4">
          <PeopleTableToolbar
            search={search}
            onSearchChange={setSearch}
            category={category}
            onCategoryChange={setCategory}
            onAddPerson={() => setFormOpen(true)}
            selectedCount={selectedIds.length}
            onAddToShortlist={() => setShortlistDialogOpen(true)}
          />

          <PeopleTable
            people={people}
            loading={loading}
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            onPageChange={goToPage}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            sortBy={sortBy}
            sortDirection={sortDirection}
            onSortChange={handleSortChange}
            onSelectionChange={setSelectedIds}
            shortlistsByPerson={shortlistsByEntity}
          />
        </TabsContent>

        <TabsContent value="shortlists">
          <ShortlistsTab entityType="person" />
        </TabsContent>
      </Tabs>

      <PersonForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleCreate}
      />

      <AddToShortlistDialog
        open={shortlistDialogOpen}
        onClose={() => setShortlistDialogOpen(false)}
        entityType="person"
        selectedIds={selectedIds}
        onDone={() => { setSelectedIds([]); refetchMemberships() }}
      />
    </div>
  )
}
