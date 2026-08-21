"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

type WorkspaceState = {
  workspaceId: string | null
  userId: string | null
  loading: boolean
}

const WorkspaceContext = createContext<WorkspaceState>({
  workspaceId: null,
  userId: null,
  loading: true,
})

// Única fonte do workspaceId no cliente. Antes cada hook refazia auth.getUser()
// por conta própria; agora todos resolvem daqui.
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WorkspaceState>({
    workspaceId: null,
    userId: null,
    loading: true,
  })
  const router = useRouter()

  useEffect(() => {
    async function resolve() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        setState({ workspaceId: null, userId: null, loading: false })
        return
      }

      const { data: member } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", user.id)
        .maybeSingle()

      // Sem workspace, current_workspace() retorna null e TODAS as policies dão
      // falso: a pessoa veria um CRM vazio sem erro nenhum. Mandar pro /invite
      // é o que transforma isso em algo explicável.
      if (!member) {
        setState({ workspaceId: null, userId: user.id, loading: false })
        router.replace("/invite")
        return
      }

      setState({ workspaceId: member.workspace_id, userId: user.id, loading: false })
    }
    resolve()
  }, [router])

  return <WorkspaceContext.Provider value={state}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  return useContext(WorkspaceContext)
}
