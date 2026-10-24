"use client"

import Link from "next/link"
import { Mail, MessageCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { ConversationItem } from "@/lib/hub/open-items"

const ago = (h: number) => (h >= 48 ? `${Math.floor(h / 24)} dias` : h >= 1 ? `${h} h` : "agora")

export function ConversationList({
  items,
  empty,
  dismissLabel,
  onDismiss,
}: {
  items: ConversationItem[]
  empty: string
  dismissLabel: string
  onDismiss: (c: ConversationItem) => void
}) {
  if (!items.length) return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>
  return (
    <div className="space-y-2">
      {items.map((c) => (
        <Card key={c.conversationKey}>
          <CardContent className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 text-sm">
                {c.channel === "gmail" ? <Mail className="h-4 w-4 shrink-0" /> : <MessageCircle className="h-4 w-4 shrink-0" />}
                <Link href={`/companies/${c.companyId}`} className="font-medium hover:underline">
                  {c.companyName}
                </Link>
                <Badge variant={c.ageHours > 24 ? "destructive" : "secondary"}>há {ago(c.ageHours)}</Badge>
              </div>
              <p className="truncate text-sm">{c.title}</p>
              {c.preview && <p className="line-clamp-2 text-xs text-muted-foreground">“{c.preview}”</p>}
            </div>
            <div className="flex shrink-0 gap-2">
              {c.url && (
                <Button asChild size="sm" variant="outline">
                  <a href={c.url} target="_blank" rel="noopener noreferrer">
                    Abrir
                  </a>
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => onDismiss(c)}>
                {dismissLabel}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
