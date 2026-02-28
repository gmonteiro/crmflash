"use client"

import { useState, useCallback } from "react"
import { usePeople } from "@/hooks/use-people"
import { PeopleTable } from "@/components/people/people-table"
import { PeopleTableToolbar } from "@/components/people/people-table-toolbar"
import { PersonForm } from "@/components/people/person-form"
import type { PersonFormData } from "@/lib/validators"
import { toast } from "sonner"

export default function PeoplePage() {
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("all")
  const [page, setPage] = useState(0)
  const [formOpen, setFormOpen] = useState(false)

  const { people, loading, pageCount, createPerson, updatePerson, deletePerson } = usePeople({
    search: search || undefined,
    category: category !== "all" ? category : undefined,
    page,
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

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">People</h1>

      <PeopleTableToolbar
        search={search}
        onSearchChange={(v) => { setSearch(v); setPage(0) }}
        category={category}
        onCategoryChange={(v) => { setCategory(v); setPage(0) }}
        onAddPerson={() => setFormOpen(true)}
      />

      <PeopleTable
        people={people}
        loading={loading}
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />

      <PersonForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleCreate}
      />
    </div>
  )
}
