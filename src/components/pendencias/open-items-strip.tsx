"use client"

import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { useOpenItems } from "@/hooks/use-open-items"

const ago = (h: number) => (h >= 48 ? `${Math.floor(h / 24)} dias` : `${h} h`)

/** Faixa do dashboard: os quatro contadores e as 3 conversas mais antigas esperando você. */
export function OpenItemsStrip() {
  const { data } = useOpenItems()
  if (!data) return null
  const counts = [
    { label: "Aguardando você", n: data.waitingYou.length, tab: "you", alert: data.waitingYou.some((c) => c.ageHours > 24) },
    { label: "Aguardando o cliente", n: data.waitingClient.length, tab: "client", alert: false },
    { label: "Decisões", n: data.decisions.length, tab: "decisions", alert: false },
    { label: "Sistema", n: data.system.length, tab: "system", alert: data.system.length > 0 },
  ]
  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {counts.map((c) => (
            <Link key={c.tab} href={`/pendencias?tab=${c.tab}`} className="rounded-md border p-3 transition-colors hover:bg-muted/50">
              <div className={`text-2xl font-bold ${c.alert ? "text-destructive" : ""}`}>{c.n}</div>
              <div className="text-xs text-muted-foreground">{c.label}</div>
            </Link>
          ))}
        </div>
        {data.waitingYou.slice(0, 3).map((c) => (
          <Link key={c.conversationKey} href="/pendencias" className="block truncate text-sm hover:underline">
            <b>{c.companyName}</b> · {c.title} · há {ago(c.ageHours)}
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}
