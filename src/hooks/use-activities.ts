"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import type { Activity } from "@/types/database"

interface UseActivitiesOptions {
  personId?: string
  companyId?: string
}

export function useActivities({ personId, companyId }: UseActivitiesOptions) {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)

  const fetchActivities = useCallback(async () => {
    if (!personId && !companyId) {
      setActivities([])
      setLoading(false)
      return
    }

    setLoading(true)
    const supabase = createClient()

    let query = supabase
      .from("activities")
      .select("*, person:people(id, full_name), company:companies(id, name)")
      .order("date", { ascending: false })
      .limit(200)

    if (personId) query = query.eq("person_id", personId)
    if (companyId) query = query.eq("company_id", companyId)

    const { data } = await query

    if (data) setActivities(data as Activity[])
    setLoading(false)
  }, [personId, companyId])

  useEffect(() => {
    fetchActivities()
  }, [fetchActivities])

  return { activities, loading, refetch: fetchActivities }
}
