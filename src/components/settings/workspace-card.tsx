"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { Users } from "lucide-react"
import { useWorkspaceMembers, useMemberEmails } from "@/hooks/use-workspace-members"
import { useWorkspace } from "@/lib/workspace/context"

export function WorkspaceCard() {
  const { userId } = useWorkspace()
  const { members, invitations, loading, invite, removeMember, cancelInvite } =
    useWorkspaceMembers()
  const emails = useMemberEmails()
  const [email, setEmail] = useState("")
  const [sending, setSending] = useState(false)

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setSending(true)
    try {
      await invite(email)
      setEmail("")
      toast.success("Convite criado. A pessoa vê ao entrar na conta dela.")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao convidar")
    } finally {
      setSending(false)
    }
  }

  async function handleRemove(id: string) {
    try {
      await removeMember(id)
      toast.success("Pessoa removida do workspace")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover")
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-4 w-4" /> Workspace
        </CardTitle>
        <CardDescription>
          Todo mundo aqui vê e edita o mesmo CRM, e pode convidar mais gente.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <ul className="space-y-2">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                {/* Cai pro id curto enquanto o RPC de e-mails nao existir. */}
                <span className="truncate">
                  {emails[m.user_id] ?? `${m.user_id.slice(0, 8)}…`}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  {m.user_id === userId && <Badge variant="secondary">você</Badge>}
                  {m.user_id !== userId && (
                    <Button variant="ghost" size="sm" onClick={() => handleRemove(m.user_id)}>
                      Remover
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {invitations.length > 0 && (
          <ul className="space-y-2 border-t pt-4">
            {invitations.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{i.invited_email}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline">pendente</Badge>
                  <Button variant="ghost" size="sm" onClick={() => cancelInvite(i.id)}>
                    Cancelar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleInvite} className="flex gap-2 border-t pt-4">
          <Input
            type="email"
            placeholder="email@exemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" disabled={sending}>
            {sending ? "Convidando…" : "Convidar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
