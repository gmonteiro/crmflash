"use client"

import { useState, useRef, useCallback } from "react"
import type { EnrichSSEEvent } from "@/lib/enrich/types"

async function parseSSEStream(
  res: Response,
  onEvent: (event: EnrichSSEEvent) => void,
): Promise<boolean> {
  const reader = res.body?.getReader()
  if (!reader) return false

  const decoder = new TextDecoder()
  let buffer = ""
  let success = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue
      try {
        const event = JSON.parse(line.slice(6)) as EnrichSSEEvent
        onEvent(event)
        if (event.type === "result" && event.success) success = true
      } catch { /* skip malformed lines */ }
    }
  }

  return success
}

export function useEnrich() {
  const [loading, setLoading] = useState(false)
  const [reasoning, setReasoning] = useState("")

  const clearReasoning = useCallback(() => setReasoning(""), [])

  async function enrichPerson(personId: string) {
    setLoading(true)
    setReasoning("")
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "person", personId }),
      })
      return await parseSSEStream(res, (event) => {
        if (event.type === "reasoning") {
          setReasoning((prev) => prev + event.text)
        }
      })
    } catch {
      return false
    } finally {
      setLoading(false)
    }
  }

  async function enrichCompany(companyId: string) {
    setLoading(true)
    setReasoning("")
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "company", companyId }),
      })
      return await parseSSEStream(res, (event) => {
        if (event.type === "reasoning") {
          setReasoning((prev) => prev + event.text)
        }
      })
    } catch {
      return false
    } finally {
      setLoading(false)
    }
  }

  return { enrichPerson, enrichCompany, loading, reasoning, clearReasoning }
}

interface BulkItem {
  id: string
  name: string
}

interface BulkEnrichState {
  running: boolean
  current: number
  total: number
  currentName: string
  succeeded: number
  failed: number
  reasoning: string
}

export function useBulkEnrich() {
  const [state, setState] = useState<BulkEnrichState>({
    running: false,
    current: 0,
    total: 0,
    currentName: "",
    succeeded: 0,
    failed: 0,
    reasoning: "",
  })
  const cancelRef = useRef(false)

  const run = useCallback(async (items: BulkItem[]) => {
    cancelRef.current = false
    setState({
      running: true,
      current: 0,
      total: items.length,
      currentName: "",
      succeeded: 0,
      failed: 0,
      reasoning: "",
    })

    let succeeded = 0
    let failed = 0

    // Process in batches of 5
    for (let i = 0; i < items.length; i += 5) {
      if (cancelRef.current) break

      const batch = items.slice(i, i + 5)
      const batchNames = batch.map((b) => b.name).join(", ")
      setState((prev) => ({
        ...prev,
        current: i + 1,
        currentName: batchNames,
        reasoning: "",
      }))

      try {
        const res = await fetch("/api/enrich/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyIds: batch.map((b) => b.id) }),
        })

        await parseSSEStream(res, (event) => {
          if (event.type === "reasoning") {
            setState((prev) => ({ ...prev, reasoning: prev.reasoning + event.text }))
          }
          if (event.type === "batch_item") {
            if (event.success) succeeded++
            else failed++
            setState((prev) => ({
              ...prev,
              current: Math.min(i + succeeded + failed, items.length),
              succeeded,
              failed,
            }))
          }
        })
      } catch {
        // If batch fails entirely, count all as failed
        failed += batch.length
        setState((prev) => ({ ...prev, succeeded, failed }))
      }
    }

    setState((prev) => ({ ...prev, running: false }))
  }, [])

  const cancel = useCallback(() => {
    cancelRef.current = true
  }, [])

  return { ...state, run, cancel }
}
