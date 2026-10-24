"use client"

import Link from "next/link"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { DecideBody } from "@/hooks/use-open-items"
import type { DecisionItem } from "@/lib/hub/open-items"

export function DecisionList({ items, onDecide }: { items: DecisionItem[]; onDecide: (b: DecideBody) => Promise<{ ok: boolean; detail: string }> }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<Record<string, string>>({})
  if (!items.length) return <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma decisão esperando você.</p>

  async function run(id: string, body: DecideBody) {
    setBusy(id)
    setMsg((m) => ({ ...m, [id]: "" }))
    const r = await onDecide(body)
    setBusy(null)
    if (!r.ok) setMsg((m) => ({ ...m, [id]: r.detail || "Não deu certo." }))
  }

  return (
    <div className="space-y-2">
      {items.map((d) => (
        <Card key={`${d.kind}:${d.id}`}>
          <CardContent className="space-y-2 py-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline">{d.kind === "identity" ? "identidade" : "proposta"}</Badge>
              <span className="font-medium">{d.title}</span>
              {d.companyId && d.kind === "identity" && (
                <Link href={`/companies/${d.companyId}`} className="text-xs text-muted-foreground hover:underline">
                  {d.companyName}
                </Link>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{d.detail}</p>

            {!d.decidableHere && d.kind === "identity" && (
              <p className="text-xs">Resolver no claude.ai: <code>resolve_identity</code> reprocessa as transcrições do projeto ou da reunião.</p>
            )}
            {!d.decidableHere && d.kind === "proposal" && d.companyId && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/companies/${d.companyId}`}>Decidir no copiloto da conta</Link>
              </Button>
            )}

            {d.decidableHere && d.kind === "identity" && (
              <div className="flex flex-wrap gap-2">
                {d.candidates.slice(0, 3).map((c, i) =>
                  c.personId ? (
                    <Button key={i} size="sm" disabled={busy === d.id} onClick={() => run(d.id, { type: "review", id: d.id, resolution: { type: "link_person", personId: c.personId! } })}>
                      É {c.label}
                    </Button>
                  ) : c.companyId ? (
                    <Button key={i} size="sm" disabled={busy === d.id} onClick={() => run(d.id, { type: "review", id: d.id, resolution: { type: "link_company", companyId: c.companyId! } })}>
                      É da {c.label}
                    </Button>
                  ) : null
                )}
                <Button size="sm" variant="ghost" disabled={busy === d.id} onClick={() => run(d.id, { type: "review", id: d.id, resolution: { type: "ignore" } })}>
                  Ignorar
                </Button>
              </div>
            )}
            {d.decidableHere && d.kind === "proposal" && (
              <div className="flex gap-2">
                <Button size="sm" disabled={busy === d.id} onClick={() => run(d.id, { type: "inference", id: d.id, decision: "accept" })}>
                  Aceitar
                </Button>
                <Button size="sm" variant="ghost" disabled={busy === d.id} onClick={() => run(d.id, { type: "inference", id: d.id, decision: "reject" })}>
                  Recusar
                </Button>
              </div>
            )}
            {msg[d.id] && <p className="text-xs text-destructive">{msg[d.id]}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
