"use client"

import { useState, useRef, useCallback } from "react"

export function useEnrich() {
  const [loading, setLoading] = useState(false)

  async function enrichPerson(personId: string) {
    setLoading(true)
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "person", personId }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Enrichment failed")
      }

      return true
    } catch {
      return false
    } finally {
      setLoading(false)
    }
  }

  async function enrichCompany(companyId: string) {
    setLoading(true)
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "company", companyId }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Enrichment failed")
      }

      return true
    } catch {
      return false
    } finally {
      setLoading(false)
    }
  }

  return { enrichPerson, enrichCompany, loading }
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
}

export function useBulkEnrich() {
  const [state, setState] = useState<BulkEnrichState>({
    running: false,
    current: 0,
    total: 0,
    currentName: "",
    succeeded: 0,
    failed: 0,
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
    })

    let succeeded = 0
    let failed = 0

    for (let i = 0; i < items.length; i++) {
      if (cancelRef.current) break

      const item = items[i]
      setState((prev) => ({
        ...prev,
        current: i + 1,
        currentName: item.name,
      }))

      try {
        const res = await fetch("/api/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "company", companyId: item.id }),
        })
        if (res.ok) succeeded++
        else failed++
      } catch {
        failed++
      }

      setState((prev) => ({ ...prev, succeeded, failed }))
    }

    setState((prev) => ({ ...prev, running: false }))
  }, [])

  const cancel = useCallback(() => {
    cancelRef.current = true
  }, [])

  return { ...state, run, cancel }
}
