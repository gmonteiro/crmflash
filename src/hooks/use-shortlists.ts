"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import type { Shortlist, ShortlistMember, ShortlistEntityType } from "@/types/database"

export function useShortlistMemberships(entityType: ShortlistEntityType) {
  const [map, setMap] = useState<Record<string, { id: string; name: string }[]>>({})

  const fetch = useCallback(async () => {
    const supabase = createClient()
    const idField = entityType === "person" ? "person_id" : "company_id"

    const { data, error } = await supabase
      .from("shortlist_members")
      .select(`${idField}, shortlist:shortlists(id, name, entity_type)`)
      .not(idField, "is", null)

    if (!error && data) {
      const result: Record<string, { id: string; name: string }[]> = {}
      for (const row of data as Record<string, unknown>[]) {
        const entityId = row[idField] as string
        const sl = row.shortlist as { id: string; name: string; entity_type: string } | null
        if (!entityId || !sl || sl.entity_type !== entityType) continue
        if (!result[entityId]) result[entityId] = []
        result[entityId].push({ id: sl.id, name: sl.name })
      }
      setMap(result)
    }
  }, [entityType])

  useEffect(() => {
    fetch()
  }, [fetch])

  return { shortlistsByEntity: map, refetch: fetch }
}

export function useShortlists(entityType: ShortlistEntityType) {
  const [shortlists, setShortlists] = useState<Shortlist[]>([])
  const [loading, setLoading] = useState(true)

  const fetchShortlists = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    const { data, error } = await supabase
      .from("shortlists")
      .select("*, shortlist_members(count)")
      .eq("entity_type", entityType)
      .order("created_at", { ascending: false })

    if (!error && data) {
      const mapped = data.map((s: Record<string, unknown>) => ({
        ...s,
        member_count: ((s.shortlist_members as { count: number }[])?.[0]?.count ?? 0),
      })) as Shortlist[]
      setShortlists(mapped)
    }
    setLoading(false)
  }, [entityType])

  useEffect(() => {
    fetchShortlists()
  }, [fetchShortlists])

  const createShortlist = useCallback(async (name: string, description?: string) => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data, error } = await supabase
      .from("shortlists")
      .insert({ name, description: description || null, entity_type: entityType, user_id: user.id })
      .select()
      .single()

    if (!error && data) {
      const newShortlist = { ...data, member_count: 0 } as Shortlist
      setShortlists((prev) => [newShortlist, ...prev])
      return newShortlist
    }
    return null
  }, [entityType])

  const updateShortlist = useCallback(async (id: string, updates: { name?: string; description?: string }) => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false

    // Optimistic
    setShortlists((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)))

    const { error } = await supabase
      .from("shortlists")
      .update(updates)
      .eq("id", id)
      .eq("user_id", user.id)

    if (error) {
      fetchShortlists()
      return false
    }
    return true
  }, [fetchShortlists])

  const deleteShortlist = useCallback(async (id: string) => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false

    setShortlists((prev) => prev.filter((s) => s.id !== id))

    const { error } = await supabase
      .from("shortlists")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)

    if (error) {
      fetchShortlists()
      return false
    }
    return true
  }, [fetchShortlists])

  const addMembers = useCallback(async (shortlistId: string, entityIds: string[]) => {
    const supabase = createClient()
    const idField = entityType === "person" ? "person_id" : "company_id"

    let hasError = false
    for (const eid of entityIds) {
      const { error } = await supabase
        .from("shortlist_members")
        .insert({ shortlist_id: shortlistId, [idField]: eid })

      // Ignore unique constraint violations (already a member)
      if (error && !error.message.includes("duplicate") && !error.code?.startsWith("23")) {
        hasError = true
      }
    }

    if (!hasError) {
      // Update count optimistically
      setShortlists((prev) =>
        prev.map((s) =>
          s.id === shortlistId
            ? { ...s, member_count: (s.member_count ?? 0) + entityIds.length }
            : s
        )
      )
      // Refetch for accurate count
      fetchShortlists()
    }
    return !hasError
  }, [entityType, fetchShortlists])

  const removeMember = useCallback(async (memberId: string, shortlistId: string) => {
    const supabase = createClient()

    const { error } = await supabase
      .from("shortlist_members")
      .delete()
      .eq("id", memberId)

    if (!error) {
      setShortlists((prev) =>
        prev.map((s) =>
          s.id === shortlistId
            ? { ...s, member_count: Math.max(0, (s.member_count ?? 1) - 1) }
            : s
        )
      )
    }
    return !error
  }, [])

  const fetchMembers = useCallback(async (shortlistId: string): Promise<ShortlistMember[]> => {
    const supabase = createClient()

    const select = entityType === "person"
      ? "*, person:people(id, full_name, email, current_title, current_company)"
      : "*, company:companies(id, name, industry, size_tier)"

    const { data, error } = await supabase
      .from("shortlist_members")
      .select(select)
      .eq("shortlist_id", shortlistId)
      .order("added_at", { ascending: false })

    if (!error && data) return data as ShortlistMember[]
    return []
  }, [entityType])

  return {
    shortlists,
    loading,
    refetch: fetchShortlists,
    createShortlist,
    updateShortlist,
    deleteShortlist,
    addMembers,
    removeMember,
    fetchMembers,
  }
}
