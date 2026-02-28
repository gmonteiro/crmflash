"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import type { Company } from "@/types/database"

interface UseCompaniesOptions {
  search?: string
  industry?: string
  page?: number
  pageSize?: number
}

export function useCompanies(options: UseCompaniesOptions = {}) {
  const { search, industry, page = 0, pageSize = 25 } = options
  const [companies, setCompanies] = useState<Company[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const fetchCompanies = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    let query = supabase
      .from("companies")
      .select("*", { count: "exact" })

    if (search) {
      query = query.ilike("name", `%${search}%`)
    }
    if (industry) {
      query = query.eq("industry", industry)
    }

    query = query
      .order("created_at", { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1)

    const { data, count, error } = await query

    if (!error && data) {
      setCompanies(data)
      setTotalCount(count ?? 0)
    }
    setLoading(false)
  }, [search, industry, page, pageSize])

  useEffect(() => {
    fetchCompanies()
  }, [fetchCompanies])

  async function createCompany(data: Partial<Company>) {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data: company, error } = await supabase
      .from("companies")
      .insert({ ...data, user_id: user.id })
      .select()
      .single()

    if (!error && company) {
      setCompanies((prev) => [company, ...prev])
      setTotalCount((prev) => prev + 1)
      return company
    }
    return null
  }

  async function updateCompany(id: string, data: Partial<Company>) {
    const supabase = createClient()

    setCompanies((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...data } : c))
    )

    const { error } = await supabase
      .from("companies")
      .update(data)
      .eq("id", id)

    if (error) {
      fetchCompanies()
      return false
    }
    return true
  }

  async function deleteCompany(id: string) {
    const supabase = createClient()

    setCompanies((prev) => prev.filter((c) => c.id !== id))
    setTotalCount((prev) => prev - 1)

    const { error } = await supabase
      .from("companies")
      .delete()
      .eq("id", id)

    if (error) {
      fetchCompanies()
      return false
    }
    return true
  }

  return {
    companies,
    totalCount,
    loading,
    refetch: fetchCompanies,
    createCompany,
    updateCompany,
    deleteCompany,
    pageCount: Math.ceil(totalCount / pageSize),
  }
}

export function useCompanySearch() {
  const [results, setResults] = useState<Company[]>([])
  const [searching, setSearching] = useState(false)

  async function search(query: string) {
    if (!query || query.length < 2) {
      setResults([])
      return
    }
    setSearching(true)
    const supabase = createClient()
    const { data } = await supabase
      .from("companies")
      .select("id, name")
      .ilike("name", `%${query}%`)
      .limit(10)

    setResults((data ?? []) as Company[])
    setSearching(false)
  }

  return { results, searching, search }
}
