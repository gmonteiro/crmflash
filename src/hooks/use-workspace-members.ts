"use client"

import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useWorkspace } from "@/lib/workspace/context"
import type { WorkspaceInvitation, WorkspaceMember } from "@/types/database"

export function useWorkspaceMembers() {
  const { workspaceId } = useWorkspace()
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const refresh = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    const [m, i] = await Promise.all([
      supabase.from("workspace_members").select("*").eq("workspace_id", workspaceId),
      supabase
        .from("workspace_invitations")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("status", "pending"),
    ])
    setMembers((m.data ?? []) as WorkspaceMember[])
    setInvitations((i.data ?? []) as WorkspaceInvitation[])
    setLoading(false)
  }, [workspaceId, supabase])

  useEffect(() => {
    refresh()
  }, [refresh])

  const invite = useCallback(
    async (email: string) => {
      if (!workspaceId) throw new Error("Sem workspace")
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Não autenticado")

      const { error } = await supabase.from("workspace_invitations").insert({
        workspace_id: workspaceId,
        invited_email: email.trim().toLowerCase(),
        invited_by: user.id,
      })

      // 23505 = unique_violation em (workspace_id, invited_email).
      if (error) {
        throw new Error(
          error.code === "23505" ? "Já existe convite para este e-mail" : error.message
        )
      }
      await refresh()
    },
    [workspaceId, refresh, supabase]
  )

  const removeMember = useCallback(
    async (userId: string) => {
      const { error } = await supabase.from("workspace_members").delete().eq("user_id", userId)

      // O trigger prevent_last_member_removal levanta exceção; o PostgREST
      // devolve a mensagem crua do Postgres, que não serve pra usuário.
      if (error) {
        throw new Error(
          /ultimo membro/i.test(error.message)
            ? "Não dá para remover a última pessoa do workspace"
            : error.message
        )
      }
      await refresh()
    },
    [refresh, supabase]
  )

  const cancelInvite = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("workspace_invitations").delete().eq("id", id)
      if (error) throw new Error(error.message)
      await refresh()
    },
    [refresh, supabase]
  )

  return { members, invitations, loading, invite, removeMember, cancelInvite, refresh }
}

/**
 * Mapa user_id → e-mail dos membros do workspace.
 *
 * auth.users não é legível pelo cliente, então isso vem de um RPC
 * SECURITY DEFINER que só devolve quem é do meu workspace. A alternativa seria
 * uma tabela de perfis; enquanto o workspace tem duas ou três pessoas, o RPC
 * custa menos do que manter perfis em sincronia.
 */
export function useMemberEmails(): Record<string, string> {
  const { workspaceId } = useWorkspace()
  const [emails, setEmails] = useState<Record<string, string>>({})
  const supabase = createClient()

  useEffect(() => {
    if (!workspaceId) return
    async function load() {
      const { data } = await supabase.rpc("workspace_member_emails")
      if (data) {
        setEmails(
          Object.fromEntries(
            (data as { user_id: string; email: string }[]).map((r) => [r.user_id, r.email])
          )
        )
      }
    }
    load()
  }, [workspaceId, supabase])

  return emails
}
