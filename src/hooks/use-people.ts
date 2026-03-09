"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import type { Person } from "@/types/database"

interface UsePeopleOptions {
  search?: string
  category?: string
  companyId?: string
  pageSize?: number
  sortBy?: string
  sortDesc?: boolean
}

export function usePeople(options: UsePeopleOptions = {}) {
  const { search, category, companyId, pageSize = 25, sortBy = "created_at", sortDesc = true } = options
  const [people, setPeople] = useState<Person[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage] = useState(0)

  const hasMore = people.length < totalCount

  const fetchPage = useCallback(async (pageNum: number, append: boolean) => {
    if (append) setLoadingMore(true)
    else setLoading(true)

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
      .range(pageNum * pageSize, (pageNum + 1) * pageSize - 1)

    const { data, count, error } = await query

    if (!error && data) {
      if (append) {
        setPeople((prev) => [...prev, ...(data as Person[])])
      } else {
        setPeople(data as Person[])
      }
      setTotalCount(count ?? 0)
    }
    setLoading(false)
    setLoadingMore(false)
  }, [search, category, companyId, pageSize, sortBy, sortDesc])

  // Reset and fetch first page when filters/sort change
  useEffect(() => {
    setPage(0)
    fetchPage(0, false)
  }, [fetchPage])

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return
    const nextPage = page + 1
    setPage(nextPage)
    fetchPage(nextPage, true)
  }, [page, loadingMore, hasMore, fetchPage])

  const refetch = useCallback(() => {
    setPage(0)
    fetchPage(0, false)
  }, [fetchPage])

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
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false

    // Optimistic update
    setPeople((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...data } : p))
    )

    const { error } = await supabase
      .from("people")
      .update(data)
      .eq("id", id)
      .eq("user_id", user.id)

    if (error) {
      refetch()
      return false
    }
    return true
  }

  async function deletePerson(id: string) {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false

    setPeople((prev) => prev.filter((p) => p.id !== id))
    setTotalCount((prev) => prev - 1)

    const { error } = await supabase
      .from("people")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)

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
    loadingMore,
    hasMore,
    loadMore,
    refetch,
    createPerson,
    updatePerson,
    deletePerson,
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
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false

    const { error } = await supabase
      .from("people")
      .update(data)
      .eq("id", id)
      .eq("user_id", user.id)

    if (!error) {
      setPerson((prev) => prev ? { ...prev, ...data } : prev)
      return true
    }
    return false
  }

  return { person, loading, update, setPerson, refetch: load }
}
