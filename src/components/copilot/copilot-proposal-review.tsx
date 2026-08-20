"use client"

import { useState } from "react"
import { format, parseISO } from "date-fns"
import { AlertTriangle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { COMMITMENT_SIGNALS } from "@/lib/constants"
import type { CommitmentSignalType } from "@/types/database"
import type { CopilotUpdateProposal, ProposalSelection } from "@/types/copilot"

interface CopilotProposalReviewProps {
  proposal: CopilotUpdateProposal
  stageTitle: string | null
  applying?: boolean
  onApply: (selection: ProposalSelection) => void
  onDiscard: () => void
}

const signalLabel = (type: string) =>
  COMMITMENT_SIGNALS.find((s) => s.value === type)?.label ?? type

const STAGE_MOVE_LABEL: Record<string, string> = {
  advance: "Avançar um estágio",
  retreat: "Voltar um estágio",
  frozen: "Mover para Gelado",
  won: "Marcar como Ganho",
  lost: "Marcar como Perdido",
}

function Row({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  children: React.ReactNode
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 hover:bg-muted/50">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <span className="text-sm leading-snug">{children}</span>
    </label>
  )
}

export function CopilotProposalReview({
  proposal,
  stageTitle,
  applying,
  onApply,
  onDiscard,
}: CopilotProposalReviewProps) {
  // Tudo pré-marcado: o caminho rápido é confirmar, não montar a seleção.
  const [sel, setSel] = useState<ProposalSelection>({
    client_event: proposal.client_event_today,
    stage: proposal.stage_move !== "none",
    signals: [...proposal.commitment_signals],
    next_step: !!proposal.next_step,
    champion_name: !!proposal.fields.champion_name,
    economic_buyer_name: !!proposal.fields.economic_buyer_name,
    pain_hypothesis: !!proposal.fields.pain_hypothesis,
    note: true,
  })

  const set = <K extends keyof ProposalSelection>(key: K, value: ProposalSelection[K]) =>
    setSel((prev) => ({ ...prev, [key]: value }))

  const toggleSignal = (signal: CommitmentSignalType, on: boolean) =>
    setSel((prev) => ({
      ...prev,
      signals: on ? [...prev.signals, signal] : prev.signals.filter((s) => s !== signal),
    }))

  const stageLabel = proposal.stage_target_title
    ? `Mover ${stageTitle ?? "?"} → ${proposal.stage_target_title}`
    : (STAGE_MOVE_LABEL[proposal.stage_move] ?? "Mover de estágio")

  const nothingToApply =
    !proposal.client_event_today &&
    proposal.stage_move === "none" &&
    proposal.commitment_signals.length === 0 &&
    !proposal.next_step &&
    !proposal.fields.champion_name &&
    !proposal.fields.economic_buyer_name &&
    !proposal.fields.pain_hypothesis

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">O que eu entendi</h3>
        {proposal.summary && (
          <p className="text-sm text-muted-foreground">{proposal.summary}</p>
        )}
      </div>

      {proposal.confidence === "low" && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Confiança baixa: a narração foi vaga, então não proponho mudança de estágio.
            Revise antes de aplicar.
          </span>
        </div>
      )}

      {nothingToApply ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Não identifiquei nenhuma mudança concreta. Vou registrar só a nota no histórico.
        </p>
      ) : (
        <div className="space-y-0.5">
          {proposal.client_event_today && (
            <Row checked={sel.client_event} onChange={(v) => set("client_event", v)}>
              Marcar <strong>evento do cliente hoje</strong>
            </Row>
          )}

          {proposal.stage_move !== "none" && (
            <Row checked={sel.stage} onChange={(v) => set("stage", v)}>
              {stageLabel}
            </Row>
          )}

          {proposal.commitment_signals.map((signal) => (
            <Row
              key={signal}
              checked={sel.signals.includes(signal)}
              onChange={(v) => toggleSignal(signal, v)}
            >
              Registrar sinal: <strong>{signalLabel(signal)}</strong>
            </Row>
          ))}

          {proposal.next_step && (
            <Row checked={sel.next_step} onChange={(v) => set("next_step", v)}>
              Criar próximo passo «{proposal.next_step.title}»
              {proposal.next_step.due_date
                ? ` para ${format(parseISO(proposal.next_step.due_date), "dd/MM")}`
                : ""}
            </Row>
          )}

          {proposal.fields.champion_name && (
            <Row checked={sel.champion_name} onChange={(v) => set("champion_name", v)}>
              Definir champion: <strong>{proposal.fields.champion_name}</strong>
            </Row>
          )}

          {proposal.fields.economic_buyer_name && (
            <Row
              checked={sel.economic_buyer_name}
              onChange={(v) => set("economic_buyer_name", v)}
            >
              Definir quem assina: <strong>{proposal.fields.economic_buyer_name}</strong>
            </Row>
          )}

          {proposal.fields.pain_hypothesis && (
            <Row checked={sel.pain_hypothesis} onChange={(v) => set("pain_hypothesis", v)}>
              Registrar hipótese de dor: «{proposal.fields.pain_hypothesis}»
            </Row>
          )}
        </div>
      )}

      <div className="space-y-0.5 border-t pt-2">
        <Row checked={sel.note} onChange={(v) => set("note", v)}>
          Salvar sua narração no histórico da conta
        </Row>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDiscard} disabled={applying}>
          Descartar
        </Button>
        <Button size="sm" onClick={() => onApply(sel)} disabled={applying}>
          {applying && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Aplicar
        </Button>
      </div>
    </div>
  )
}
