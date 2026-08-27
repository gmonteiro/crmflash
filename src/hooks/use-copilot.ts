"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { format } from "date-fns"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"
import { useWorkspace } from "@/lib/workspace/context"
import { fetchPipelineSnapshot } from "@/lib/pipeline/snapshot"
import { detectQuestions } from "@/lib/pipeline/rules"
import { buildCompanyQueue } from "@/lib/pipeline/queue"
import { applyEffect as applyEffectImpl } from "@/lib/pipeline/effects"
import { recordCopilotEvent } from "@/lib/pipeline/copilot-events"
import type { PipelineSnapshot } from "@/lib/pipeline/types"
import { COMMITMENT_SIGNALS, NARRATION_SUPPRESS_DAYS } from "@/lib/constants"
import type {
  CompanyQueueItem,
  CopilotEffect,
  CopilotInterpretError,
  CopilotInterpretResult,
  CopilotQuestion,
  CopilotQuickAction,
  CopilotUpdateProposal,
  ProposalSelection,
} from "@/types/copilot"

const DATE_FMT = "yyyy-MM-dd"

const INTERPRET_ERRORS: readonly CopilotInterpretError[] = [
  "rate_limited",
  "provider_error",
  "unparsed",
  "unauthorized",
  "not_configured",
  "forbidden",
  "bad_request",
  "not_found",
  "network",
]

// O status HTTP é o plano B: o corpo carrega um code explícito porque 502 sozinho
// não distingue "o provedor caiu" de "o modelo respondeu algo que não valida".
const STATUS_FALLBACK: Record<number, CopilotInterpretError> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  429: "rate_limited",
  500: "not_configured",
  502: "provider_error",
}

async function failureReason(res: Response): Promise<CopilotInterpretError> {
  try {
    const body = (await res.json()) as { code?: unknown }
    const code = body?.code
    if (typeof code === "string" && (INTERPRET_ERRORS as readonly string[]).includes(code)) {
      return code as CopilotInterpretError
    }
  } catch {
    // corpo vazio ou não-JSON (proxy, timeout de borda) — cai no status
  }
  return STATUS_FALLBACK[res.status] ?? "provider_error"
}
const today = () => format(new Date(), DATE_FMT)

// Uma quick action que só abre os rascunhos não altera o CRM nem suprime a
// pergunta — a UI intercepta antes de chamar runAction.
export function isDraftAction(action: CopilotQuickAction): boolean {
  return action.effects.some((e) => e.kind === "open_drafts")
}

const signalLabel = (type: string): string =>
  COMMITMENT_SIGNALS.find((s) => s.value === type)?.label ?? type

// Traduz o movimento proposto pelo modelo num efeito de estágio. Um título
// explícito (validado no servidor contra as colunas reais) tem precedência.
function stageEffectFor(proposal: CopilotUpdateProposal): CopilotEffect | null {
  if (proposal.stage_move === "none") return null
  if (proposal.stage_target_title) {
    return { kind: "move_stage", target: "title", title: proposal.stage_target_title }
  }
  switch (proposal.stage_move) {
    case "advance":
      return { kind: "move_stage", target: "next" }
    case "retreat":
      return { kind: "move_stage", target: "prev" }
    case "frozen":
      return { kind: "move_stage", target: "title", title: "Gelado" }
    case "won":
      return { kind: "move_stage", target: "title", title: "Ganho" }
    case "lost":
      return { kind: "move_stage", target: "title", title: "Perdido" }
    default:
      return null
  }
}

export function useCopilot() {
  const { workspaceId } = useWorkspace()
  const [questions, setQuestions] = useState<CopilotQuestion[]>([])
  const [loading, setLoading] = useState(true)
  const [interpreting, setInterpreting] = useState(false)
  const snapshotRef = useRef<PipelineSnapshot | null>(null)

  const fetchQuestions = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    const [snapshot, suppressedRes] = await Promise.all([
      fetchPipelineSnapshot(supabase, {
        includeActivities: true,
        activityDays: 7,
        includePeople: true,
      }),
      supabase
        .from("copilot_question_events")
        .select("question_key")
        .gte("suppress_until", today())
        .limit(2000),
    ])

    snapshotRef.current = snapshot

    const suppressed = new Set(
      ((suppressedRes.data ?? []) as { question_key: string }[]).map((r) => r.question_key)
    )

    setQuestions(detectQuestions(snapshot, suppressed))
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchQuestions()
  }, [fetchQuestions])

  // Preenche o contexto e delega. A escrita de verdade mora em
  // lib/pipeline/effects.ts, porque o servidor MCP precisa dela tambem.
  const applyEffect = useCallback(
    async (
      supabase: SupabaseClient,
      userId: string,
      question: CopilotQuestion,
      effect: CopilotEffect
    ) => {
      if (!workspaceId) return
      await applyEffectImpl(
        supabase,
        {
          workspaceId,
          userId,
          companyId: question.companyId,
          snapshot: snapshotRef.current,
        },
        effect
      )
    },
    [workspaceId]
  )

  // Registra a resposta. E isto que faz a pergunta sumir da fila ate suppress_until.
  const recordEvent = useCallback(
    async (
      supabase: SupabaseClient,
      userId: string,
      question: CopilotQuestion,
      params: {
        status: "answered" | "snoozed" | "dismissed"
        suppressDays: number
        actionId?: string | null
        answerText?: string | null
        applied?: Record<string, unknown> | null
      }
    ) => {
      if (!workspaceId) return
      await recordCopilotEvent(supabase, {
        workspaceId,
        userId,
        companyId: question.companyId,
        questionKey: question.key,
        ruleId: question.ruleId,
        status: params.status,
        suppressDays: params.suppressDays,
        actionId: params.actionId,
        answerText: params.answerText,
        applied: params.applied,
      })
    },
    [workspaceId]
  )

  const runAction = useCallback(
    async (question: CopilotQuestion, actionId: string): Promise<boolean> => {
      const action = question.actions.find((a) => a.id === actionId)
      if (!action) return false

      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !workspaceId) return false

      // Otimista: tira da fila antes de escrever.
      setQuestions((prev) => prev.filter((q) => q.key !== question.key))

      try {
        for (const effect of action.effects) {
          await applyEffect(supabase, user.id, question, effect)
        }
        await recordEvent(supabase, user.id, question, {
          status: "answered",
          suppressDays: action.suppressDays,
          actionId: action.id,
        })
        return true
      } catch {
        fetchQuestions()
        return false
      }
    },
    [workspaceId, applyEffect, recordEvent, fetchQuestions]
  )

  const snooze = useCallback(
    async (question: CopilotQuestion, days: number): Promise<boolean> => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !workspaceId) return false

      setQuestions((prev) => prev.filter((q) => q.key !== question.key))
      await recordEvent(supabase, user.id, question, {
        status: "snoozed",
        suppressDays: days,
      })
      return true
    },
    [workspaceId, recordEvent]
  )

  // Descartar = suprimir por um ano.
  const dismiss = useCallback(
    async (question: CopilotQuestion): Promise<boolean> => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !workspaceId) return false

      setQuestions((prev) => prev.filter((q) => q.key !== question.key))
      await recordEvent(supabase, user.id, question, {
        status: "dismissed",
        suppressDays: 365,
      })
      return true
    },
    [workspaceId, recordEvent]
  )

  // Adia todas as perguntas abertas até amanhã.
  const snoozeAll = useCallback(async (): Promise<boolean> => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !workspaceId) return false

    const pending = questions
    setQuestions([])
    for (const q of pending) {
      await recordEvent(supabase, user.id, q, { status: "snoozed", suppressDays: 1 })
    }
    return true
  }, [workspaceId, questions, recordEvent])

  // Manda a narração para o servidor interpretar. Não escreve nada — devolve
  // uma proposta que o usuário revisa item a item antes de aplicar.
  const interpret = useCallback(
    async (item: CompanyQueueItem, narration: string): Promise<CopilotInterpretResult> => {
      const lead = item.pendings[0]
      if (!lead) return { ok: false, reason: "bad_request" }

      setInterpreting(true)
      try {
        const res = await fetch("/api/copilot/interpret", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId: item.companyId,
            questionKey: lead.key,
            ruleId: lead.ruleId,
            // O modelo recebe TODAS as pendências do card, não só a principal:
            // sabendo que falta champion e próximo passo, ele extrai os dois da
            // mesma narração em vez de responder só a pergunta do topo.
            questionTitle: item.pendings.map((p) => p.title).join(" | ").slice(0, 500),
            narration,
          }),
        })
        if (!res.ok) return { ok: false, reason: await failureReason(res) }
        const data = (await res.json()) as { proposal?: CopilotUpdateProposal }
        return data.proposal
          ? { ok: true, proposal: data.proposal }
          : { ok: false, reason: "unparsed" }
      } catch {
        return { ok: false, reason: "network" }
      } finally {
        setInterpreting(false)
      }
    },
    []
  )

  const applyProposal = useCallback(
    async (
      item: CompanyQueueItem,
      proposal: CopilotUpdateProposal,
      sel: ProposalSelection,
      narration: string
    ): Promise<boolean> => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !workspaceId) return false

      // A pendência mais prioritária responde pelos efeitos: applyEffect só usa
      // company_id, e o log de auditoria de cada pendência vem depois, no passo 7.
      const question = item.pendings[0]
      if (!question) return false

      // Otimista: o card inteiro sai da fila, porque a narração responde a conta.
      setQuestions((prev) => prev.filter((q) => q.companyId !== item.companyId))

      try {
        // 1. Campos de texto da conta.
        const fieldMap = [
          ["champion_name", sel.champion_name, proposal.fields.champion_name],
          ["economic_buyer_name", sel.economic_buyer_name, proposal.fields.economic_buyer_name],
          ["pain_hypothesis", sel.pain_hypothesis, proposal.fields.pain_hypothesis],
        ] as const
        for (const [field, picked, value] of fieldMap) {
          if (picked && value) {
            await applyEffect(supabase, user.id, question, { kind: "set_field", field, value })
          }
        }

        // 2. Sinais (cada um já marca evento do cliente e loga no timeline).
        for (const signal of sel.signals) {
          await applyEffect(supabase, user.id, question, {
            kind: "capture_signal",
            signal,
            label: signalLabel(signal),
          })
        }

        // 3. Próximo passo.
        if (sel.next_step && proposal.next_step) {
          await applyEffect(supabase, user.id, question, {
            kind: "create_next_step",
            title: proposal.next_step.title,
            dueDate: proposal.next_step.due_date ?? undefined,
            inDays: 3,
          })
        }

        // 4. Evento do cliente (os sinais já bumparam; isto cobre o caso sem sinal).
        if (sel.client_event && proposal.client_event_today && sel.signals.length === 0) {
          await applyEffect(supabase, user.id, question, { kind: "mark_client_event" })
        }

        // 5. Nota no timeline com a narração original.
        if (sel.note) {
          await supabase.from("company_activities").insert({
            user_id: user.id,
            company_id: question.companyId,
            type: "note",
            title: `Copiloto: ${proposal.summary || question.title}`.slice(0, 300),
            description: proposal.note ? `${proposal.note}\n\n---\n${narration}` : narration,
            date: new Date().toISOString(),
          })
        }

        // 6. Movimento de estágio por último, para o stage event cair depois do
        //    estado que ele descreve.
        if (sel.stage) {
          const effect = stageEffectFor(proposal)
          if (effect) await applyEffect(supabase, user.id, question, effect)
        }

        // 7. Auditoria: um evento por pendência exibida no card. Narrar responde a
        //    conta toda — o que a narração resolveu por dado some sozinho no
        //    próximo load (as regras recomputam), e o que continua verdadeiro fica
        //    suprimido pelos dias da própria regra em vez de voltar amanhã.
        for (const pending of item.pendings) {
          await recordEvent(supabase, user.id, pending, {
            status: "answered",
            suppressDays: NARRATION_SUPPRESS_DAYS[pending.ruleId] ?? 3,
            answerText: narration,
            applied:
              pending.key === question.key
                ? ({ proposal, selection: sel } as unknown as Record<string, unknown>)
                : null,
          })
        }
        return true
      } catch {
        fetchQuestions()
        return false
      }
    },
    [workspaceId, applyEffect, recordEvent, fetchQuestions]
  )

  // Adiar a conta inteira: mesmo efeito de "já respondi isso hoje", só que
  // explícito e por 1 dia, sem passar pela IA.
  const snoozeCompany = useCallback(
    async (item: CompanyQueueItem, days = 1): Promise<boolean> => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !workspaceId) return false

      setQuestions((prev) => prev.filter((q) => q.companyId !== item.companyId))
      for (const pending of item.pendings) {
        await recordEvent(supabase, user.id, pending, { status: "snoozed", suppressDays: days })
      }
      return true
    },
    [workspaceId, recordEvent]
  )

  const queue = useMemo(() => buildCompanyQueue(questions), [questions])

  return {
    queue,
    loading,
    interpreting,
    refetch: fetchQuestions,
    runAction,
    interpret,
    applyProposal,
    snooze,
    snoozeCompany,
    snoozeAll,
    dismiss,
  }
}
