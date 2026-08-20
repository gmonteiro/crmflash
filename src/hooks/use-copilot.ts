"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { addDays, format } from "date-fns"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"
import { fetchPipelineSnapshot } from "@/lib/pipeline/snapshot"
import { detectQuestions } from "@/lib/pipeline/rules"
import { applyStageMove } from "@/lib/pipeline/move"
import { nextStage, prevStage, stageByTitle, colById } from "@/lib/pipeline/stages"
import type { PipelineSnapshot } from "@/lib/pipeline/types"
import { COMMITMENT_SIGNALS } from "@/lib/constants"
import type {
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

  // Executa um efeito. Cada escrita filtra por user_id (defense-in-depth sobre a RLS).
  const applyEffect = useCallback(
    async (supabase: SupabaseClient, userId: string, question: CopilotQuestion, effect: CopilotEffect) => {
      const companyId = question.companyId
      const snap = snapshotRef.current
      const now = new Date().toISOString()

      switch (effect.kind) {
        case "none":
        case "open_drafts":
          return

        case "mark_client_event":
          await supabase
            .from("companies")
            .update({ last_client_event_at: now })
            .eq("id", companyId)
            .eq("user_id", userId)
          return

        case "note":
          await supabase.from("company_activities").insert({
            user_id: userId,
            company_id: companyId,
            type: "note",
            title: effect.text,
            date: now,
          })
          return

        case "set_field":
          await supabase
            .from("companies")
            .update({ [effect.field]: effect.value })
            .eq("id", companyId)
            .eq("user_id", userId)
          return

        case "create_next_step": {
          const dueDate =
            effect.dueDate ?? format(addDays(new Date(), effect.inDays ?? 3), DATE_FMT)
          const { error } = await supabase.from("company_next_steps").insert({
            user_id: userId,
            company_id: companyId,
            title: effect.title,
            due_date: dueDate,
            status: "pending",
          })
          if (error) return
          // Espelha o comportamento de use-company-next-steps.createStep.
          await supabase.from("company_activities").insert({
            user_id: userId,
            company_id: companyId,
            type: "next_step_created",
            title: `Next step created: ${effect.title}`,
            date: now,
          })
          return
        }

        case "complete_next_step":
          await supabase
            .from("company_next_steps")
            .update({ status: "completed", completed_at: now })
            .eq("id", effect.stepId)
            .eq("user_id", userId)
          return

        case "reschedule_next_step":
          await supabase
            .from("company_next_steps")
            .update({ due_date: format(addDays(new Date(), effect.inDays), DATE_FMT) })
            .eq("id", effect.stepId)
            .eq("user_id", userId)
          return

        case "delete_next_step":
          await supabase
            .from("company_next_steps")
            .delete()
            .eq("id", effect.stepId)
            .eq("user_id", userId)
          return

        case "capture_signal": {
          // UNIQUE(company_id, signal_type): se já existe, o insert falha e nada
          // mais acontece — capturar de novo não deve reescrever o histórico.
          const { error } = await supabase.from("company_commitment_signals").insert({
            user_id: userId,
            company_id: companyId,
            signal_type: effect.signal,
            captured_at: now,
          })
          if (error) return
          // Sinal de compromisso é um evento do cliente → reseta o contador.
          await supabase
            .from("companies")
            .update({ last_client_event_at: now })
            .eq("id", companyId)
            .eq("user_id", userId)
          await supabase.from("company_activities").insert({
            user_id: userId,
            company_id: companyId,
            type: "note",
            title: `Sinal de compromisso: ${effect.label}`,
            date: now,
          })
          return
        }

        case "move_stage": {
          if (!snap) return
          const company = snap.companies.find((c) => c.id === companyId)
          if (!company) return
          const byId = colById(snap.columns)
          const from = byId.get(company.kanban_column_id) ?? null
          if (!from) return

          let to = null
          if (effect.target === "next") to = nextStage(snap.columns, from)
          else if (effect.target === "prev") to = prevStage(snap.columns, from)
          else if (effect.title) to = stageByTitle(snap.columns, effect.title)
          if (!to || to.id === from.id) return

          // Entra no fim da coluna de destino.
          const inTarget = snap.companies.filter((c) => c.kanban_column_id === to!.id)
          const maxPos = inTarget.reduce((m, c) => Math.max(m, c.kanban_position ?? 0), 0)

          await applyStageMove(supabase, {
            userId,
            companyId,
            from,
            to,
            position: maxPos + 1,
          })
          return
        }
      }
    },
    []
  )

  // Registra a resposta. É isto que faz a pergunta sumir da fila até suppress_until.
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
      await supabase.from("copilot_question_events").insert({
        user_id: userId,
        company_id: question.companyId,
        question_key: question.key,
        rule_id: question.ruleId,
        status: params.status,
        action_id: params.actionId ?? null,
        answer_text: params.answerText ?? null,
        applied: params.applied ?? null,
        suppress_until: format(addDays(new Date(), params.suppressDays), DATE_FMT),
      })
    },
    []
  )

  const runAction = useCallback(
    async (question: CopilotQuestion, actionId: string): Promise<boolean> => {
      const action = question.actions.find((a) => a.id === actionId)
      if (!action) return false

      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return false

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
    [applyEffect, recordEvent, fetchQuestions]
  )

  const snooze = useCallback(
    async (question: CopilotQuestion, days: number): Promise<boolean> => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return false

      setQuestions((prev) => prev.filter((q) => q.key !== question.key))
      await recordEvent(supabase, user.id, question, {
        status: "snoozed",
        suppressDays: days,
      })
      return true
    },
    [recordEvent]
  )

  // Descartar = suprimir por um ano.
  const dismiss = useCallback(
    async (question: CopilotQuestion): Promise<boolean> => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return false

      setQuestions((prev) => prev.filter((q) => q.key !== question.key))
      await recordEvent(supabase, user.id, question, {
        status: "dismissed",
        suppressDays: 365,
      })
      return true
    },
    [recordEvent]
  )

  // Adia todas as perguntas abertas até amanhã.
  const snoozeAll = useCallback(async (): Promise<boolean> => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false

    const pending = questions
    setQuestions([])
    for (const q of pending) {
      await recordEvent(supabase, user.id, q, { status: "snoozed", suppressDays: 1 })
    }
    return true
  }, [questions, recordEvent])

  // Manda a narração para o servidor interpretar. Não escreve nada — devolve
  // uma proposta que o usuário revisa item a item antes de aplicar.
  const interpret = useCallback(
    async (question: CopilotQuestion, narration: string): Promise<CopilotInterpretResult> => {
      setInterpreting(true)
      try {
        const res = await fetch("/api/copilot/interpret", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId: question.companyId,
            questionKey: question.key,
            ruleId: question.ruleId,
            questionTitle: question.title,
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
      question: CopilotQuestion,
      proposal: CopilotUpdateProposal,
      sel: ProposalSelection,
      narration: string
    ): Promise<boolean> => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return false

      setQuestions((prev) => prev.filter((q) => q.key !== question.key))

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

        // 7. Auditoria: o que a narração de fato alterou.
        await recordEvent(supabase, user.id, question, {
          status: "answered",
          suppressDays: 3,
          answerText: narration,
          applied: { proposal, selection: sel } as unknown as Record<string, unknown>,
        })
        return true
      } catch {
        fetchQuestions()
        return false
      }
    },
    [applyEffect, recordEvent, fetchQuestions]
  )

  const countsByCompany = new Map<string, number>()
  for (const q of questions) {
    countsByCompany.set(q.companyId, (countsByCompany.get(q.companyId) ?? 0) + 1)
  }

  return {
    questions,
    countsByCompany,
    loading,
    interpreting,
    refetch: fetchQuestions,
    runAction,
    interpret,
    applyProposal,
    snooze,
    snoozeAll,
    dismiss,
  }
}
