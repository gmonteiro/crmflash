"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { useWorkspace } from "@/lib/workspace/context"
import type { Person } from "@/types/database"

interface UsePeopleOptions {
  search?: string
  category?: string
  companyId?: string
  /** user_id do dono. Filtra pelo vinculo, nao pela autoria. */
  ownerId?: string
  pageSize?: number
  sortBy?: string
  sortDesc?: boolean
}

export function usePeople(options: UsePeopleOptions = {}) {
  const { workspaceId } = useWorkspace()
  const { search, category, companyId, ownerId, pageSize = 25, sortBy = "created_at", sortDesc = true } = options
  const [people, setPeople] = useState<Person[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  const fetchPage = useCallback(async (pageNum: number) => {
    setLoading(true)

    const supabase = createClient()

    // O embed !inner e o filtro: descarta quem nao tem vinculo com esse dono,
    // e como a PK de people_owners e (person_id, user_id) nenhuma pessoa casa
    // duas vezes — a contagem continua exata e a paginacao nao repete linha.
    let query = supabase
      .from("people")
      .select(
        ownerId
          ? "*, company:companies(*), people_owners!inner(user_id)"
          : "*, company:companies(*)",
        { count: "exact" }
      )

    if (ownerId) {
      query = query.eq("people_owners.user_id", ownerId)
    }

    if (search) {
      query = query.ilike("full_name", `%${search}%`)
    }
    if (category) {
      query = query.eq("category", category)
    }
    if (companyId) {
      query = query.eq("company_id", companyId)
    }

    query = query
      .order(sortBy, { ascending: !sortDesc })
      .order("id", { ascending: true })
      .range(pageNum * pageSize, (pageNum + 1) * pageSize - 1)

    const { data, count, error } = await query

    if (!error && data) {
      setPeople(data as Person[])
      setTotalCount(count ?? 0)
    }
    setLoading(false)
  }, [search, category, companyId, ownerId, pageSize, sortBy, sortDesc])

  // Reset and fetch first page when filters/sort change
  useEffect(() => {
    setPage(0)
    fetchPage(0)
  }, [fetchPage])

  const goToPage = useCallback((p: number) => {
    const clamped = Math.max(0, Math.min(p, totalPages - 1))
    setPage(clamped)
    fetchPage(clamped)
  }, [totalPages, fetchPage])

  const refetch = useCallback(() => {
    fetchPage(page)
  }, [fetchPage, page])

  async function createPerson(data: Partial<Person>) {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !workspaceId) return null

    const { data: person, error } = await supabase
      .from("people")
      .insert({
        ...data,
        workspace_id: workspaceId,
        user_id: user.id,
      })
      .select("*, company:companies(*)")
      .single()

    if (!error && person) {
      setPeople((prev) => [person as Person, ...prev])
      setTotalCount((prev) => prev + 1)
      return person
    }
    return null
  }

  async function updatePerson(id: string, data: Partial<Person>) {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !workspaceId) return false

    // Optimistic update
    setPeople((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...data } : p))
    )

    const { error } = await supabase
      .from("people")
      .update(data)
      .eq("id", id)
      .eq("workspace_id", workspaceId)

    if (error) {
      refetch()
      return false
    }
    return true
  }

  async function deletePerson(id: string) {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !workspaceId) return false

    setPeople((prev) => prev.filter((p) => p.id !== id))
    setTotalCount((prev) => prev - 1)

    const { error } = await supabase
      .from("people")
      .delete()
      .eq("id", id)
      .eq("workspace_id", workspaceId)

    if (error) {
      refetch()
      return false
    }
    return true
  }

  return {
    people,
    totalCount,
    loading,
    page,
    totalPages,
    goToPage,
    refetch,
    createPerson,
    updatePerson,
    deletePerson,
  }
}

export function usePerson(id: string) {
  const { workspaceId } = useWorkspace()
  const [person, setPerson] = useState<Person | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from("people")
      .select("*, company:companies(*)")
      .eq("id", id)
      .single()

    if (data) setPerson(data as Person)
    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function update(data: Partial<Person>) {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !workspaceId) return false

    const { error } = await supabase
      .from("people")
      .update(data)
      .eq("id", id)
      .eq("workspace_id", workspaceId)

    if (!error) {
      setPerson((prev) => prev ? { ...prev, ...data } : prev)
      return true
    }
    return false
  }

  return { person, loading, update, setPerson, refetch: load }
}
