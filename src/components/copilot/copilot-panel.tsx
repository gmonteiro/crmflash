"use client"

import { useState, useCallback } from "react"
import { toast } from "sonner"
import { CheckCircle2, Sparkles, Building2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { CopilotCompanyCard } from "./copilot-company-card"
import { CopilotProposalReview } from "./copilot-proposal-review"
import { isDraftAction, useCopilot } from "@/hooks/use-copilot"
import type {
  CopilotInterpretError,
  CopilotQuestion,
  CopilotUpdateProposal,
  ProposalSelection,
} from "@/types/copilot"

interface CopilotPanelProps {
  /** Chamado depois de qualquer escrita, para o resto da página recarregar. */
  onApplied?: () => void
}

// A proposta fica amarrada à conta que a gerou: se a fila avança, ela deixa
// de ser válida sozinha, sem efeito de limpeza.
interface PendingProposal {
  companyId: string
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
  const {
    queue,
    loading,
    interpreting,
    runAction,
    interpret,
    applyProposal,
    snoozeCompany,
    snoozeAll,
  } = copilot

  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingProposal | null>(null)

  // A seleção é derivada: se a conta escolhida saiu da fila, cai na primeira.
  const current = queue.find((c) => c.companyId === selectedCompanyId) ?? queue[0] ?? null
  const proposal = pending && current && pending.companyId === current.companyId ? pending : null
  const pendingCount = queue.reduce((sum, c) => sum + c.pendings.length, 0)

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

  // Atalho resolve UMA pendência: o resto do card continua de pé.
  const handleAction = useCallback(
    async (question: CopilotQuestion, actionId: string) => {
      const action = question.actions.find((a) => a.id === actionId)
      if (!action) return

      // Rascunhos chegam na Fase 2 — a ação existe mas ainda não tem tela.
      if (isDraftAction(action)) {
        toast.info("Rascunhos de mensagem chegam na próxima fase")
        return
      }

      setBusy(true)
      const ok = await runAction(question, actionId)
      setBusy(false)
      afterWrite(ok)
    },
    [runAction, afterWrite]
  )

  const handleNarrate = useCallback(
    async (text: string) => {
      if (!current) return
      const result = await interpret(current, text)
      if (!result.ok) {
        toast.error(INTERPRET_ERROR_MESSAGE[result.reason])
        return
      }
      setPending({ companyId: current.companyId, proposal: result.proposal, narration: text })
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
      setSelectedCompanyId(null)
      afterWrite(ok)
    },
    [current, proposal, applyProposal, afterWrite]
  )

  const handleSnoozeCompany = useCallback(async () => {
    if (!current) return
    setBusy(true)
    const ok = await snoozeCompany(current)
    setBusy(false)
    setSelectedCompanyId(null)
    if (ok) {
      toast.success(`${current.companyName} adiada para amanhã`)
      onApplied?.()
    }
  }, [current, snoozeCompany, onApplied])

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
            {!loading && queue.length > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
                {queue.length}
              </Badge>
            )}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {loading
              ? "Lendo o pipeline…"
              : queue.length === 0
                ? "Nada pedindo sua atenção agora."
                : `${queue.length} ${queue.length === 1 ? "conta precisa" : "contas precisam"} de você · ${pendingCount} ${pendingCount === 1 ? "pendência" : "pendências"}`}
          </p>
        </div>
        {!loading && queue.length > 0 && (
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
                <CopilotCompanyCard
                  // Remonta a cada conta, zerando o rascunho de narração.
                  key={current.companyId}
                  item={current}
                  busy={busy}
                  interpreting={interpreting}
                  onAction={handleAction}
                  onNarrate={handleNarrate}
                  onSnoozeCompany={handleSnoozeCompany}
                />
              )}
            </div>

            {queue.length > 1 && (
              <div className="space-y-2 lg:border-l lg:pl-6">
                <p className="text-xs font-medium text-muted-foreground">
                  Na fila ({queue.length})
                </p>
                <div className="space-y-1">
                  {queue.map((item) => (
                    <button
                      key={item.companyId}
                      onClick={() => setSelectedCompanyId(item.companyId)}
                      className={cn(
                        "w-full rounded-md border p-2 text-left transition-colors hover:bg-muted/50",
                        item.companyId === current.companyId
                          ? "border-violet-500/50 bg-violet-500/5"
                          : "border-transparent"
                      )}
                    >
                      <span className="flex items-center gap-1.5 text-xs font-medium">
                        <Building2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">{item.companyName}</span>
                        <span className="ml-auto shrink-0 text-[11px] font-normal text-muted-foreground">
                          {item.pendings.length}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {item.pendings[0]?.title}
                      </span>
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
