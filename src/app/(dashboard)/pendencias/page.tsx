"use client"

import { Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ConversationList } from "@/components/pendencias/conversation-list"
import { DecisionList } from "@/components/pendencias/decision-list"
import { useOpenItems } from "@/hooks/use-open-items"
import type { ConversationItem } from "@/lib/hub/open-items"

const TABS = ["you", "client", "decisions", "system"] as const

function Pendencias() {
  const { data, loading, error, dismiss, decide } = useOpenItems()
  const params = useSearchParams()
  const tab = TABS.find((t) => t === params.get("tab")) ?? "you"
  // Dispensar pede o motivo num diálogo (nada de window.prompt).
  const [pending, setPending] = useState<{ c: ConversationItem; side: "client" | "lumeis" } | null>(null)
  const [reason, setReason] = useState("")

  async function confirmDismiss() {
    if (!pending) return
    await dismiss(pending.c, pending.side, reason.trim() || null)
    setPending(null)
    setReason("")
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Pendências</h1>
        <p className="text-sm text-muted-foreground">Tudo que está esperando você. Nada aqui muda estágio sozinho.</p>
      </div>
      {error && <p className="text-sm text-destructive">Não consegui carregar: {error}</p>}
      {loading && !data ? (
        <Skeleton className="h-64" />
      ) : data ? (
        <Tabs defaultValue={tab}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="you">Aguardando você ({data.waitingYou.length})</TabsTrigger>
            <TabsTrigger value="client">Aguardando o cliente ({data.waitingClient.length})</TabsTrigger>
            <TabsTrigger value="decisions">Decisões ({data.decisions.length})</TabsTrigger>
            <TabsTrigger value="system">Sistema ({data.system.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="you">
            <ConversationList
              items={data.waitingYou}
              empty="Ninguém esperando resposta sua."
              dismissLabel="Já resolvi"
              onDismiss={(c) => setPending({ c, side: "client" })}
            />
          </TabsContent>
          <TabsContent value="client">
            <ConversationList
              items={data.waitingClient}
              empty="Nenhum cliente há mais de 3 dias sem responder."
              dismissLabel="Parar de esperar"
              onDismiss={(c) => setPending({ c, side: "lumeis" })}
            />
          </TabsContent>
          <TabsContent value="decisions">
            <DecisionList items={data.decisions} onDecide={decide} />
          </TabsContent>
          <TabsContent value="system">
            {data.system.length ? (
              <ul className="space-y-2">
                {data.system.map((s) => (
                  <li key={s.key} className="flex items-start gap-2 text-sm">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    {s.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">Tudo rodando.</p>
            )}
          </TabsContent>
        </Tabs>
      ) : null}

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending?.side === "client" ? "Já resolvi" : "Parar de esperar"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {pending?.c.companyName}: {pending?.c.title}. Se chegar mensagem nova, a conversa volta para a lista.
          </p>
          <Textarea placeholder="Motivo (opcional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmDismiss}>Dispensar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function PendenciasPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <Pendencias />
    </Suspense>
  )
}
