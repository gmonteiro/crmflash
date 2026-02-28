"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import type { Person } from "@/types/database"

interface UsePeopleOptions {
  search?: string
  category?: string
  companyId?: string
  page?: number
  pageSize?: number
  sortBy?: string
  sortDesc?: boolean
}

export function usePeople(options: UsePeopleOptions = {}) {
  const { search, category, companyId, page = 0, pageSize = 25, sortBy = "created_at", sortDesc = true } = options
  const [people, setPeople] = useState<Person[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const fetchPeople = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    let query = supabase
      .from("people")
      .select("*, company:companies(*)", { count: "exact" })

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
      .range(page * pageSize, (page + 1) * pageSize - 1)

    const { data, count, error } = await query

    if (!error && data) {
      setPeople(data as Person[])
      setTotalCount(count ?? 0)
    }
    setLoading(false)
  }, [search, category, companyId, page, pageSize, sortBy, sortDesc])

  useEffect(() => {
    fetchPeople()
  }, [fetchPeople])

  async function createPerson(data: Partial<Person>) {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data: person, error } = await supabase
      .from("people")
      .insert({
        ...data,
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

    // Optimistic update
    setPeople((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...data } : p))
    )

    const { error } = await supabase
      .from("people")
      .update(data)
      .eq("id", id)

    if (error) {
      fetchPeople() // Revert on error
      return false
    }
    return true
  }

  async function deletePerson(id: string) {
    const supabase = createClient()

    setPeople((prev) => prev.filter((p) => p.id !== id))
    setTotalCount((prev) => prev - 1)

    const { error } = await supabase
      .from("people")
      .delete()
      .eq("id", id)

    if (error) {
      fetchPeople()
      return false
    }
    return true
  }

  return {
    people,
    totalCount,
    loading,
    refetch: fetchPeople,
    createPerson,
    updatePerson,
    deletePerson,
    pageCount: Math.ceil(totalCount / pageSize),
  }
}

export function usePerson(id: string) {
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
    const { error } = await supabase
      .from("people")
      .update(data)
      .eq("id", id)

    if (!error) {
      setPerson((prev) => prev ? { ...prev, ...data } : prev)
      return true
    }
    return false
  }

  return { person, loading, update, setPerson, refetch: load }
}
