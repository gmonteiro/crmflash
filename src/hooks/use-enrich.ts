"use client"

import { useState } from "react"

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
