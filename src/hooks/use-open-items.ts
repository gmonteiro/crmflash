"use client"

import { useCallback, useEffect, useState } from "react"
import type { ConversationItem, OpenItems } from "@/lib/hub/open-items"
import type { ReviewResolution } from "@/types/copilot"

export type DecideBody =
  | { type: "review"; id: string; resolution: ReviewResolution }
  | { type: "inference"; id: string; decision: "accept" | "reject" }

async function post(path: string, body: unknown) {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  return (await res.json().catch(() => ({ ok: false, detail: `HTTP ${res.status}` }))) as { ok: boolean; detail?: string }
}

export function useOpenItems() {
  const [data, setData] = useState<OpenItems | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/pendencias", { cache: "no-store" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData((await res.json()) as OpenItems)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const dismiss = useCallback(
    async (c: ConversationItem, side: "client" | "lumeis", reason: string | null) => {
      const r = await post("/api/pendencias/dismiss", { conversation_key: c.conversationKey, side, through: c.lastAt, reason })
      if (r.ok) await reload()
      return { ok: !!r.ok, detail: r.detail ?? (r as { error?: string }).error ?? "" }
    },
    [reload]
  )

  const decide = useCallback(
    async (body: DecideBody) => {
      const r = await post("/api/pendencias/decide", body)
      await reload()
      return { ok: !!r.ok, detail: r.detail ?? "" }
    },
    [reload]
  )

  return { data, loading, error, reload, dismiss, decide }
}
