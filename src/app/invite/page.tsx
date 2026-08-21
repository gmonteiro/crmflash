"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"
import type { WorkspaceInvitation } from "@/types/database"

// Quem chega aqui não é membro de nenhum workspace. Sem esta tela,
// current_workspace() retorna null, todas as policies dão falso, e a pessoa vê
// um CRM vazio sem erro nenhum — o pior tipo de falha, a silenciosa.
export default function InvitePage() {
  const router = useRouter()
  const supabase = createClient()
  const [invitation, setInvitation] = useState<WorkspaceInvitation | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.replace("/login")
        return
      }

      const { data: member } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", user.id)
        .maybeSingle()

      if (member) {
        router.replace("/dashboard")
        return
      }

      // A policy de select já limita aos convites endereçados ao meu e-mail.
      const { data: invite } = await supabase
        .from("workspace_invitations")
        .select("*")
        .eq("status", "pending")
        .maybeSingle()

      setInvitation((invite as WorkspaceInvitation) ?? null)
      setLoading(false)
    }
    load()
  }, [router, supabase])

  // Sem convite: cria workspace próprio. É o caminho de quem chegou sozinho.
  async function createOwn() {
    setWorking(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Não autenticado")

      const { data: ws, error: wsErr } = await supabase
        .from("workspaces")
        .insert({ name: user.email?.split("@")[0] ?? "Meu workspace", created_by: user.id })
        .select()
        .single()
      if (wsErr) throw wsErr

      const { error: memErr } = await supabase
        .from("workspace_members")
        .insert({ workspace_id: ws.id, user_id: user.id })
      if (memErr) throw memErr

      await supabase.rpc("create_default_kanban_columns", { p_workspace_id: ws.id })
      router.replace("/dashboard")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar workspace")
      setWorking(false)
    }
  }

  async function accept() {
    if (!invitation) return
    setWorking(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Não autenticado")

      const { error } = await supabase
        .from("workspace_members")
        .insert({ workspace_id: invitation.workspace_id, user_id: user.id })

      // 23505 = unique_violation no unique(user_id): esta pessoa já pertence a
      // outro workspace. Com um workspace por pessoa isso é beco sem saída — ela
      // precisa sair do atual antes. Sem traduzir, ela veria o texto cru da
      // constraint e não teria como saber o que fazer.
      if (error) {
        throw new Error(
          error.code === "23505"
            ? "Você já faz parte de outro workspace. Saia dele em Configurações antes de aceitar este convite."
            : error.message
        )
      }

      await supabase
        .from("workspace_invitations")
        .update({ status: "accepted" })
        .eq("id", invitation.id)

      router.replace("/dashboard")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao aceitar convite")
      setWorking(false)
    }
  }

  async function decline() {
    if (!invitation) return
    setWorking(true)
    await supabase
      .from("workspace_invitations")
      .update({ status: "declined" })
      .eq("id", invitation.id)
    setInvitation(null)
    setWorking(false)
  }

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Carregando…</div>
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        {invitation ? (
          <>
            <CardHeader>
              <CardTitle>Você foi convidado para um CRM</CardTitle>
              <CardDescription>
                Ao aceitar, você passa a ver e editar o mesmo funil das outras pessoas
                do workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button onClick={accept} disabled={working}>
                {working ? "Entrando…" : "Aceitar"}
              </Button>
              <Button variant="outline" onClick={decline} disabled={working}>
                Recusar
              </Button>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle>Criar seu workspace</CardTitle>
              <CardDescription>
                Você ainda não faz parte de nenhum CRM. Crie o seu para começar.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={createOwn} disabled={working}>
                {working ? "Criando…" : "Criar workspace"}
              </Button>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  )
}
