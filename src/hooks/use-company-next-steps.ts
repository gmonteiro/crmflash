"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import type { CompanyNextStep } from "@/types/database"

export function useCompanyNextSteps(companyId: string) {
  const [steps, setSteps] = useState<CompanyNextStep[]>([])
  const [loading, setLoading] = useState(true)

  const fetchSteps = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from("company_next_steps")
      .select("*")
      .eq("company_id", companyId)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(200)

    if (data) setSteps(data)
    setLoading(false)
  }, [companyId])

  useEffect(() => {
    fetchSteps()
  }, [fetchSteps])

  const createStep = useCallback(async (data: { title: string; description?: string; due_date?: string }) => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data: step, error } = await supabase
      .from("company_next_steps")
      .insert({ ...data, company_id: companyId, user_id: user.id })
      .select()
      .single()

    if (error || !step) return null

    setSteps((prev) => [...prev, step])

    // Auto-create timeline activity
    await supabase.from("company_activities").insert({
      user_id: user.id,
      company_id: companyId,
      type: "next_step_created",
      title: `Next step created: ${data.title}`,
      date: new Date().toISOString(),
    })

    return step
  }, [companyId])

  const toggleComplete = useCallback(async (id: string) => {
    const existing = steps.find((s) => s.id === id)
    if (!existing) return false

    const newStatus = existing.status === "pending" ? "completed" : "pending"
    const completedAt = newStatus === "completed" ? new Date().toISOString() : null

    setSteps((prev) =>
      prev.map((s) => s.id === id ? { ...s, status: newStatus, completed_at: completedAt } : s)
    )

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { fetchSteps(); return false }

    const { error } = await supabase
      .from("company_next_steps")
      .update({ status: newStatus, completed_at: completedAt })
      .eq("id", id)
      .eq("user_id", user.id)

    if (error) {
      fetchSteps()
      return false
    }
    return true
  }, [steps, fetchSteps])

  const deleteStep = useCallback(async (id: string) => {
    setSteps((prev) => prev.filter((s) => s.id !== id))

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { fetchSteps(); return false }

    const { error } = await supabase
      .from("company_next_steps")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)

    if (error) {
      fetchSteps()
      return false
    }
    return true
  }, [fetchSteps])

  const pending = steps.filter((s) => s.status === "pending")
  const completed = steps.filter((s) => s.status === "completed")

  return { steps, pending, completed, loading, refetch: fetchSteps, createStep, toggleComplete, deleteStep }
}
