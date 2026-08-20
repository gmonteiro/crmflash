"use client"

import { useState } from "react"
import Link from "next/link"
import { Building2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import type { CompanyQueueItem, CopilotQuestion } from "@/types/copilot"

interface CopilotCompanyCardProps {
  item: CompanyQueueItem
  busy?: boolean
  interpreting?: boolean
  onAction: (question: CopilotQuestion, actionId: string) => void
  onNarrate: (narration: string) => void
  onSnoozeCompany: () => void
}

export function CopilotCompanyCard({
  item,
  busy,
  interpreting,
  onAction,
  onNarrate,
  onSnoozeCompany,
}: CopilotCompanyCardProps) {
  // O painel remonta este componente a cada conta (key={item.companyId}),
  // então o rascunho de narração zera sozinho ao trocar de empresa.
  const [narration, setNarration] = useState("")
  const narrationReady = narration.trim().length >= 3

  // Basta uma pendência aceitar texto livre: a narração é da conta, não da regra.
  const canNarrate = item.pendings.some((p) => p.allowFreeText)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/companies/${item.companyId}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
        >
          <Building2 className="h-4 w-4 text-muted-foreground" />
          {item.companyName}
        </Link>
        {item.stageTitle && (
          <Badge variant="outline" className="text-[11px] font-normal">
            {item.stageTitle}
          </Badge>
        )}
      </div>

      <div className="space-y-4">
        {item.pendings.map((pending) => (
          <div key={pending.key} className="space-y-2">
            <div>
              <h3 className="text-sm font-medium leading-snug">{pending.title}</h3>
              {pending.subtitle && (
                <p className="text-xs text-muted-foreground">{pending.subtitle}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {pending.actions.map((action) => (
                <Button
                  key={action.id}
                  size="sm"
                  variant={action.variant ?? "secondary"}
                  disabled={busy}
                  onClick={() => onAction(pending, action.id)}
                  className="h-auto min-h-8 whitespace-normal py-1 text-left text-xs leading-snug"
                >
                  {action.label}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {canNarrate && (
        <div className="space-y-2 border-t pt-3">
          <Textarea
            rows={3}
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && narrationReady && !interpreting) {
                e.preventDefault()
                onNarrate(narration)
              }
            }}
            placeholder={`Ou conte o que aconteceu na ${item.companyName}…`}
            className="resize-none text-sm"
            disabled={interpreting}
          />
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" disabled={busy} onClick={onSnoozeCompany}>
              Adiar conta
            </Button>
            <div className="flex items-center gap-3">
              <span className="hidden text-[11px] text-muted-foreground sm:inline">
                Ctrl+Enter para enviar
              </span>
              <Button
                size="sm"
                disabled={!narrationReady || interpreting}
                onClick={() => onNarrate(narration)}
              >
                {interpreting && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                Interpretar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
