"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { startOfMonth, endOfMonth, format } from "date-fns"
import type { CompanyNextStep } from "@/types/database"

export function useCalendar(currentMonth: Date) {
  const [steps, setSteps] = useState<CompanyNextStep[]>([])
  const [loading, setLoading] = useState(true)

  const fetchSteps = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    const rangeStart = format(startOfMonth(currentMonth), "yyyy-MM-dd")
    const rangeEnd = format(endOfMonth(currentMonth), "yyyy-MM-dd")

    const { data } = await supabase
      .from("company_next_steps")
      .select("*, company:companies(id, name)")
      .gte("due_date", rangeStart)
      .lte("due_date", rangeEnd)
      .order("due_date", { ascending: true })
      .limit(500)

    if (data) setSteps(data as CompanyNextStep[])
    setLoading(false)
  }, [currentMonth])

  useEffect(() => {
    fetchSteps()
  }, [fetchSteps])

  const toggleComplete = useCallback(async (id: string) => {
    const existing = steps.find((s) => s.id === id)
    if (!existing) return false

    const newStatus = existing.status === "pending" ? "completed" : "pending"
    const completedAt = newStatus === "completed" ? new Date().toISOString() : null

    setSteps((prev) =>
      prev.map((s) => s.id === id ? { ...s, status: newStatus, completed_at: completedAt } : s)
    )

    const supabase = createClient()
    const { error } = await supabase
      .from("company_next_steps")
      .update({ status: newStatus, completed_at: completedAt })
      .eq("id", id)

    if (error) {
      fetchSteps()
      return false
    }
    return true
  }, [steps, fetchSteps])

  // Group steps by due_date string
  const stepsByDate: Record<string, CompanyNextStep[]> = {}
  for (const step of steps) {
    if (step.due_date) {
      const key = step.due_date
      if (!stepsByDate[key]) stepsByDate[key] = []
      stepsByDate[key].push(step)
    }
  }

  return { steps, stepsByDate, loading, refetch: fetchSteps, toggleComplete }
}
