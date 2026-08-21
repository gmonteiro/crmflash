"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { useWorkspace } from "@/lib/workspace/context"
import type { CommitmentSignal, CommitmentSignalType } from "@/types/database"

interface PipelineState {
  champion_name: string | null
  economic_buyer_name: string | null
  pain_hypothesis: string | null
  last_client_event_at: string | null
  stageTitle: string | null
}

export function useCompanyPipeline(companyId: string) {
  const { workspaceId } = useWorkspace()
  const [pipeline, setPipeline] = useState<PipelineState | null>(null)
  const [signals, setSignals] = useState<CommitmentSignal[]>([])
  const [loading, setLoading] = useState(true)

  const fetchPipeline = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    const [companyRes, signalsRes] = await Promise.all([
      supabase
        .from("companies")
        .select("champion_name, economic_buyer_name, pain_hypothesis, last_client_event_at, kanban_column_id")
        .eq("id", companyId)
        .single(),
      supabase
        .from("company_commitment_signals")
        .select("*")
        .eq("company_id", companyId),
    ])

    let stageTitle: string | null = null
    const columnId = companyRes.data?.kanban_column_id as string | null | undefined
    if (columnId) {
      const { data: col } = await supabase
        .from("kanban_columns")
        .select("title")
        .eq("id", columnId)
        .single()
      stageTitle = col?.title ?? null
    }

    if (companyRes.data) {
      setPipeline({
        champion_name: companyRes.data.champion_name ?? null,
        economic_buyer_name: companyRes.data.economic_buyer_name ?? null,
        pain_hypothesis: companyRes.data.pain_hypothesis ?? null,
        last_client_event_at: companyRes.data.last_client_event_at ?? null,
        stageTitle,
      })
    }
    if (signalsRes.data) setSignals(signalsRes.data as CommitmentSignal[])
    setLoading(false)
  }, [companyId])

  useEffect(() => {
    fetchPipeline()
  }, [fetchPipeline])

  // Salva um campo de texto do pipeline (champion, quem assina, hipótese de dor).
  const updateField = useCallback(
    async (field: "champion_name" | "economic_buyer_name" | "pain_hypothesis", value: string) => {
      const trimmed = value.trim()
      const next = trimmed === "" ? null : trimmed
      setPipeline((prev) => (prev ? { ...prev, [field]: next } : prev))

      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { fetchPipeline(); return }

      const { error } = await supabase
        .from("companies")
        .update({ [field]: next })
        .eq("id", companyId)
        .eq("workspace_id", workspaceId)

      if (error) fetchPipeline()
    },
    [workspaceId, companyId, fetchPipeline]
  )

  // Marca "evento do cliente hoje" (reseta o contador de card parado).
  const markClientEventToday = useCallback(async () => {
    const now = new Date().toISOString()
    setPipeline((prev) => (prev ? { ...prev, last_client_event_at: now } : prev))

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { fetchPipeline(); return }

    const { error } = await supabase
      .from("companies")
      .update({ last_client_event_at: now })
      .eq("id", companyId)
      .eq("workspace_id", workspaceId)

    if (error) fetchPipeline()
  }, [workspaceId, companyId, fetchPipeline])

  const hasSignal = useCallback(
    (type: CommitmentSignalType) => signals.some((s) => s.signal_type === type),
    [signals]
  )

  // Liga/desliga um sinal. Ao capturar: insere linha, marca evento do cliente e loga no timeline.
  const toggleSignal = useCallback(
    async (type: CommitmentSignalType, label: string) => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !workspaceId) return

      const existing = signals.find((s) => s.signal_type === type)

      if (existing) {
        setSignals((prev) => prev.filter((s) => s.id !== existing.id))
        const { error } = await supabase
          .from("company_commitment_signals")
          .delete()
          .eq("id", existing.id)
          .eq("workspace_id", workspaceId)
        if (error) fetchPipeline()
        return
      }

      const now = new Date().toISOString()
      const { data: inserted, error } = await supabase
        .from("company_commitment_signals")
        .insert({
          workspace_id: workspaceId,
          user_id: user.id,
          company_id: companyId,
          signal_type: type,
          captured_at: now,
        })
        .select()
        .single()

      if (error || !inserted) { fetchPipeline(); return }

      setSignals((prev) => [...prev, inserted as CommitmentSignal])

      // Sinal de compromisso é um evento do cliente → reseta contador.
      await supabase
        .from("companies")
        .update({ last_client_event_at: now })
        .eq("id", companyId)
        .eq("workspace_id", workspaceId)
      setPipeline((prev) => (prev ? { ...prev, last_client_event_at: now } : prev))

      // Registra no timeline da empresa.
      await supabase.from("company_activities").insert({
        workspace_id: workspaceId,
        user_id: user.id,
        company_id: companyId,
        type: "note",
        title: `Sinal de compromisso: ${label}`,
        date: now,
      })
    },
    [workspaceId, companyId, signals, fetchPipeline]
  )

  return {
    pipeline,
    signals,
    loading,
    refetch: fetchPipeline,
    updateField,
    markClientEventToday,
    hasSignal,
    toggleSignal,
  }
}
