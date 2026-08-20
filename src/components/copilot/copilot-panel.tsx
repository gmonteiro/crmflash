"use client"

import { useState, useCallback } from "react"
import { toast } from "sonner"
import { CheckCircle2, Sparkles, Building2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { CopilotQuestionCard } from "./copilot-question-card"
import { CopilotProposalReview } from "./copilot-proposal-review"
import { isDraftAction, useCopilot } from "@/hooks/use-copilot"
import type {
  CopilotInterpretError,
  CopilotUpdateProposal,
  ProposalSelection,
} from "@/types/copilot"

interface CopilotPanelProps {
  /** Chamado depois de qualquer escrita, para o resto da página recarregar. */
  onApplied?: () => void
}

// A proposta fica amarrada à pergunta que a gerou: se a fila avança, ela deixa
// de ser válida sozinha, sem efeito de limpeza.
interface PendingProposal {
  questionKey: string
  proposal: CopilotUpdateProposal
  narration: string
}

// Cada motivo pede uma ação diferente do usuário: esperar, recarregar, reformular
// ou avisar quem administra. Uma mensagem única para todos escondia o problema real.
const INTERPRET_ERROR_MESSAGE: Record<CopilotInterpretError, string> = {
  rate_limited: "Muitas tentativas seguidas. Espere um minuto e tente de novo.",
  provider_error: "A IA não respondeu agora. Tente de novo em instantes.",
  unparsed: "Não consegui interpretar. Reformule ou use os botões.",
  unauthorized: "Sua sessão expirou. Recarregue a página e entre de novo.",
  not_configured: "A IA não está configurada neste ambiente (falta a chave da API).",
  forbidden: "Requisição bloqueada por segurança. Recarregue a página.",
  bad_request: "Texto muito curto ou muito longo para interpretar.",
  not_found: "Empresa não encontrada. Recarregue a página.",
  network: "Sem conexão com o servidor. Verifique a internet e tente de novo.",
}

export function CopilotPanel({ onApplied }: CopilotPanelProps) {
  const copilot = useCopilot()
  const { questions, loading, interpreting, runAction, interpret, applyProposal, snoozeAll } =
    copilot

  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingProposal | null>(null)

  // A seleção é derivada: se a pergunta escolhida saiu da fila, cai na primeira.
  const current = questions.find((q) => q.key === selectedKey) ?? questions[0] ?? null
  const proposal = pending && current && pending.questionKey === current.key ? pending : null

  const afterWrite = useCallback(
    (ok: boolean) => {
      if (ok) {
        toast.success("Pipeline atualizado")
        onApplied?.()
      } else {
        toast.error("Não consegui salvar. Tente de novo.")
      }
    },
    [onApplied]
  )

  const handleAction = useCallback(
    async (actionId: string) => {
      if (!current) return
      const action = current.actions.find((a) => a.id === actionId)
      if (!action) return

      // Rascunhos chegam na Fase 2 — a ação existe mas ainda não tem tela.
      if (isDraftAction(action)) {
        toast.info("Rascunhos de mensagem chegam na próxima fase")
        return
      }

      setBusy(true)
      const ok = await runAction(current, actionId)
      setBusy(false)
      setSelectedKey(null)
      afterWrite(ok)
    },
    [current, runAction, afterWrite]
  )

  const handleNarrate = useCallback(
    async (text: string) => {
      if (!current) return
      const result = await interpret(current, text)
      if (!result.ok) {
        toast.error(INTERPRET_ERROR_MESSAGE[result.reason])
        return
      }
      setPending({ questionKey: current.key, proposal: result.proposal, narration: text })
    },
    [current, interpret]
  )

  const handleApplyProposal = useCallback(
    async (selection: ProposalSelection) => {
      if (!current || !proposal) return
      setBusy(true)
      const ok = await applyProposal(current, proposal.proposal, selection, proposal.narration)
      setBusy(false)
      setPending(null)
      setSelectedKey(null)
      afterWrite(ok)
    },
    [current, proposal, applyProposal, afterWrite]
  )

  const handleSnoozeAll = useCallback(async () => {
    const ok = await snoozeAll()
    if (ok) {
      toast.success("Perguntas adiadas para amanhã")
      onApplied?.()
    }
  }, [snoozeAll, onApplied])

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b pb-4">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-violet-500" />
            Copiloto
            {!loading && questions.length > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
                {questions.length}
              </Badge>
            )}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {loading
              ? "Lendo o pipeline…"
              : questions.length === 0
                ? "Nada pedindo sua atenção agora."
                : "O que aconteceu nas suas contas desde ontem?"}
          </p>
        </div>
        {!loading && questions.length > 0 && (
          <Button variant="ghost" size="sm" onClick={handleSnoozeAll}>
            Adiar tudo
          </Button>
        )}
      </CardHeader>

      <CardContent className="pt-4">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : !current ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            <p className="text-sm font-medium">Pipeline em dia</p>
            <p className="text-xs text-muted-foreground">
              Nenhuma conta parada, sem próximo passo ou sem sinal registrado.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              {proposal ? (
                <CopilotProposalReview
                  proposal={proposal.proposal}
                  stageTitle={current.stageTitle}
                  applying={busy}
                  onApply={handleApplyProposal}
                  onDiscard={() => setPending(null)}
                />
              ) : (
                <CopilotQuestionCard
                  // Remonta a cada pergunta, zerando o rascunho de narração.
                  key={current.key}
                  question={current}
                  busy={busy}
                  interpreting={interpreting}
                  onAction={handleAction}
                  onNarrate={handleNarrate}
                />
              )}
            </div>

            {questions.length > 1 && (
              <div className="space-y-2 lg:border-l lg:pl-6">
                <p className="text-xs font-medium text-muted-foreground">
                  Na fila ({questions.length})
                </p>
                <div className="space-y-1">
                  {questions.map((q) => (
                    <button
                      key={q.key}
                      onClick={() => setSelectedKey(q.key)}
                      className={cn(
                        "w-full rounded-md border p-2 text-left transition-colors hover:bg-muted/50",
                        q.key === current.key
                          ? "border-violet-500/50 bg-violet-500/5"
                          : "border-transparent"
                      )}
                    >
                      <span className="flex items-center gap-1.5 text-xs font-medium">
                        <Building2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">{q.companyName}</span>
                      </span>
                      {q.subtitle && (
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                          {q.subtitle}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
