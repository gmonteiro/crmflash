"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { fetchPipelineSnapshot } from "@/lib/pipeline/snapshot"
import { computePipelineMetrics } from "@/lib/pipeline/metrics"
import type { PipelineMetrics } from "@/lib/pipeline/metrics"

export type { PipelineMetrics }

export function usePipelineMetrics(windowDays = 7) {
  const [metrics, setMetrics] = useState<PipelineMetrics | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchMetrics = useCallback(async () => {
    setLoading(true)
    const snapshot = await fetchPipelineSnapshot(createClient())
    setMetrics(computePipelineMetrics(snapshot, { windowDays }))
    setLoading(false)
  }, [windowDays])

  useEffect(() => {
    fetchMetrics()
  }, [fetchMetrics])

  return { metrics, loading, refetch: fetchMetrics }
}
