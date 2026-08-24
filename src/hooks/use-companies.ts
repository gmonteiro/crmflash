"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { useWorkspace } from "@/lib/workspace/context"
import type { Company } from "@/types/database"

interface UseCompaniesOptions {
  search?: string
  industry?: string
  /** user_id do dono. Casa com a coluna Dono: contatos dele + empresas que criou. */
  ownerId?: string
  page?: number
  pageSize?: number
  sortBy?: string
  sortDirection?: "asc" | "desc"
}

export function useCompanies(options: UseCompaniesOptions = {}) {
  const { search, industry, ownerId, page = 0, pageSize = 25, sortBy, sortDirection } = options
  const { workspaceId } = useWorkspace()
  const [companies, setCompanies] = useState<Company[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const fetchCompanies = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    // `owners` e a relacao computada da migration 014 — company_owners e uma
    // view com union e o PostgREST nao infere relacao com view. Sem ela o
    // filtro so alcancaria empresas com contato, e discordaria da coluna nas
    // empresas sem contato nenhum.
    let query = supabase
      .from("companies")
      .select(ownerId ? "*, owners!inner(user_id)" : "*", { count: "exact" })

    if (ownerId) {
      query = query.eq("owners.user_id", ownerId)
    }

    if (search) {
      query = query.ilike("name", `%${search}%`)
    }
    if (industry) {
      query = query.eq("industry", industry)
    }

    const sortCol = sortBy || "created_at"
    const ascending = sortDirection === "asc"
    query = query
      .order(sortCol, { ascending, nullsFirst: false })
      .range(page * pageSize, (page + 1) * pageSize - 1)

    const { data, count, error } = await query

    if (!error && data) {
      setCompanies(data)
      setTotalCount(count ?? 0)
    } else if (error) {
      // Sem barulho a lista so ficaria parada na pagina anterior. O suspeito
      // numero um e o filtro por dono sem a migration 014: o PostgREST
      // devolve PGRST200 e nada na tela explica por que.
      console.error("Falha ao listar empresas:", error.message)
    }
    setLoading(false)
  }, [search, industry, ownerId, page, pageSize, sortBy, sortDirection])

  useEffect(() => {
    fetchCompanies()
  }, [fetchCompanies])

  async function createCompany(data: Partial<Company>) {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !workspaceId) return null

    const { data: company, error } = await supabase
      .from("companies")
      .insert({ ...data, workspace_id: workspaceId, user_id: user.id })
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
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !workspaceId) return false

    setCompanies((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...data } : c))
    )

    const { error } = await supabase
      .from("companies")
      .update(data)
      .eq("id", id)
      .eq("workspace_id", workspaceId)

    if (error) {
      fetchCompanies()
      return false
    }
    return true
  }

  async function deleteCompany(id: string) {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !workspaceId) return false

    setCompanies((prev) => prev.filter((c) => c.id !== id))
    setTotalCount((prev) => prev - 1)

    const { error } = await supabase
      .from("companies")
      .delete()
      .eq("id", id)
      .eq("workspace_id", workspaceId)

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
