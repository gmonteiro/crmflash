"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { useWorkspace } from "@/lib/workspace/context"
import type { CompanyActivity } from "@/types/database"

export function useCompanyActivities(companyId: string) {
  const { workspaceId } = useWorkspace()
  const [activities, setActivities] = useState<CompanyActivity[]>([])
  const [loading, setLoading] = useState(true)

  const fetchActivities = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from("company_activities")
      .select("*")
      .eq("company_id", companyId)
      .order("date", { ascending: false })
      .limit(200)

    if (data) setActivities(data)
    setLoading(false)
  }, [companyId])

  useEffect(() => {
    fetchActivities()
  }, [fetchActivities])

  const createActivity = useCallback(async (data: {
    type: string
    title: string
    description?: string
    date: string
  }) => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !workspaceId) return null

    const { data: activity, error } = await supabase
      .from("company_activities")
      .insert({ ...data, company_id: companyId, workspace_id: workspaceId, user_id: user.id })
      .select()
      .single()

    if (error || !activity) return null

    setActivities((prev) => [activity, ...prev])
    return activity
  }, [workspaceId, companyId])

  const deleteActivity = useCallback(async (id: string) => {
    setActivities((prev) => prev.filter((a) => a.id !== id))

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { fetchActivities(); return false }

    const { error } = await supabase
      .from("company_activities")
      .delete()
      .eq("id", id)
      .eq("workspace_id", workspaceId)

    if (error) {
      fetchActivities()
      return false
    }
    return true
  }, [workspaceId, fetchActivities])

  return { activities, loading, refetch: fetchActivities, createActivity, deleteActivity }
}
