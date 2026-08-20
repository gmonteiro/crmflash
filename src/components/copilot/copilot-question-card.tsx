"use client"

import { useState } from "react"
import Link from "next/link"
import { Building2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { CopilotQuestion } from "@/types/copilot"

interface CopilotQuestionCardProps {
  question: CopilotQuestion
  busy?: boolean
  interpreting?: boolean
  onAction: (actionId: string) => void
  onNarrate?: (narration: string) => void
}

export function CopilotQuestionCard({
  question,
  busy,
  interpreting,
  onAction,
  onNarrate,
}: CopilotQuestionCardProps) {
  // O drawer remonta este componente a cada pergunta (key={question.key}),
  // então o rascunho de narração zera sozinho.
  const [narration, setNarration] = useState("")

  const canNarrate = question.allowFreeText && !!onNarrate
  const narrationReady = narration.trim().length >= 3

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Link
          href={`/companies/${question.companyId}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:underline"
        >
          <Building2 className="h-3.5 w-3.5" />
          {question.companyName}
        </Link>
        <h3 className="text-base font-medium leading-snug">{question.title}</h3>
        {question.subtitle && (
          <p className="text-xs text-muted-foreground">{question.subtitle}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {question.actions.map((action) => (
          <Button
            key={action.id}
            size="sm"
            variant={action.variant ?? "default"}
            disabled={busy}
            onClick={() => onAction(action.id)}
            className="h-auto min-h-9 whitespace-normal py-1.5 text-left text-xs leading-snug"
          >
            {action.label}
          </Button>
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
                onNarrate!(narration)
              }
            }}
            placeholder="Ou conte o que aconteceu…"
            className="resize-none text-sm"
            disabled={interpreting}
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Ctrl+Enter para enviar</span>
            <Button
              size="sm"
              variant="secondary"
              disabled={!narrationReady || interpreting}
              onClick={() => onNarrate!(narration)}
            >
              {interpreting && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Interpretar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
