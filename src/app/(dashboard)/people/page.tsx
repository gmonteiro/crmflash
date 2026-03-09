"use client"

import { useState, useCallback } from "react"
import { usePeople } from "@/hooks/use-people"
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

  const { people, loading, loadingMore, hasMore, loadMore, createPerson, updatePerson, deletePerson } = usePeople({
    search: search || undefined,
    category: category !== "all" ? category : undefined,
    sortBy,
    sortDesc: sortDirection === "desc",
  })

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
            loadingMore={loadingMore}
            hasMore={hasMore}
            onLoadMore={loadMore}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            sortBy={sortBy}
            sortDirection={sortDirection}
            onSortChange={handleSortChange}
            onSelectionChange={setSelectedIds}
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
        onDone={() => setSelectedIds([])}
      />
    </div>
  )
}
