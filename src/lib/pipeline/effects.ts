import type { SupabaseClient } from "@supabase/supabase-js"
import { addDays, format } from "date-fns"
import type { CopilotEffect } from "@/types/copilot"
import type { PipelineSnapshot } from "./types"
import { applyStageMove } from "./move"
import { colById, nextStage, prevStage, stageByTitle } from "./stages"

const DATE_FMT = "yyyy-MM-dd"

export interface EffectContext {
  workspaceId: string
  userId: string | null
  companyId: string
  /** Necessário só para move_stage, que precisa das colunas e das posições. */
  snapshot: PipelineSnapshot | null
}

// Extraído de useCopilot para que o servidor MCP escreva pelo mesmo caminho que
// o painel do copiloto. Duplicar isto significaria duas definições de "o que
// acontece quando o cliente responde" — e uma delas ficaria para trás.
export async function applyEffect(
  supabase: SupabaseClient,
  ctx: EffectContext,
  effect: CopilotEffect
): Promise<void> {
  const { workspaceId, userId, companyId, snapshot: snap } = ctx
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
        .eq("workspace_id", workspaceId)
      return

    case "note":
      await supabase.from("company_activities").insert({
        workspace_id: workspaceId,
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
        .eq("workspace_id", workspaceId)
      return

    case "create_next_step": {
      const dueDate =
        effect.dueDate ?? format(addDays(new Date(), effect.inDays ?? 3), DATE_FMT)
      const { error } = await supabase.from("company_next_steps").insert({
        workspace_id: workspaceId,
        user_id: userId,
        company_id: companyId,
        title: effect.title,
        due_date: dueDate,
        status: "pending",
      })
      if (error) return
      // Espelha o comportamento de use-company-next-steps.createStep.
      await supabase.from("company_activities").insert({
        workspace_id: workspaceId,
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
        .eq("workspace_id", workspaceId)
      return

    case "reschedule_next_step":
      await supabase
        .from("company_next_steps")
        .update({ due_date: format(addDays(new Date(), effect.inDays), DATE_FMT) })
        .eq("id", effect.stepId)
        .eq("workspace_id", workspaceId)
      return

    case "delete_next_step":
      await supabase
        .from("company_next_steps")
        .delete()
        .eq("id", effect.stepId)
        .eq("workspace_id", workspaceId)
      return

    case "capture_signal": {
      // UNIQUE(company_id, signal_type): se já existe, o insert falha e nada
      // mais acontece — capturar de novo não deve reescrever o histórico.
      const { error } = await supabase.from("company_commitment_signals").insert({
        workspace_id: workspaceId,
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
        .eq("workspace_id", workspaceId)
      await supabase.from("company_activities").insert({
        workspace_id: workspaceId,
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
        workspaceId,
        userId,
        companyId,
        from,
        to,
        position: maxPos + 1,
      })
      return
    }
  }
}
