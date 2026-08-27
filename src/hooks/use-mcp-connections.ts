"use client"

import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

export interface McpConnection {
  id: string
  clientName: string
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string
}

// O client não é tipado por schema neste projeto, então a linha do join vem
// como any. Declarar a forma aqui é o que mantém o map honesto.
interface TokenRow {
  id: string
  created_at: string
  last_used_at: string | null
  expires_at: string
  mcp_oauth_clients: { client_name: string } | null
}

export function useMcpConnections() {
  const [connections, setConnections] = useState<McpConnection[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const supabase = createClient()
    // A RLS restringe a user_id = auth.uid(); o filtro de revoked_at é o que
    // separa "conexão ativa" de histórico.
    const { data } = await supabase
      .from("mcp_oauth_tokens")
      .select("id, created_at, last_used_at, expires_at, mcp_oauth_clients(client_name)")
      .is("revoked_at", null)
      .order("created_at", { ascending: false })

    const rows = (data ?? []) as unknown as TokenRow[]

    setConnections(
      rows.map((row) => ({
        id: row.id,
        clientName: row.mcp_oauth_clients?.client_name ?? "Cliente desconhecido",
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
        expiresAt: row.expires_at,
      }))
    )
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const revoke = useCallback(
    async (id: string) => {
      const supabase = createClient()
      const { error } = await supabase
        .from("mcp_oauth_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id)

      if (error) throw new Error(error.message)
      await load()
    },
    [load]
  )

  return { connections, loading, revoke }
}
