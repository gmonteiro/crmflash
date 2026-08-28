import { z } from "zod"
import { fetchPipelineSnapshot } from "@/lib/pipeline/snapshot"
import { detectQuestions } from "@/lib/pipeline/rules"
import { applyEffect } from "@/lib/pipeline/effects"
import { recordCopilotEvent } from "@/lib/pipeline/copilot-events"
import type { CopilotQuickAction } from "@/types/copilot"
import type { McpTool } from "../registry"

/**
 * Uma única ação da fila apaga: "Não faz mais sentido", na regra
 * next_step_overdue. A invariante do MCP é que nenhuma tool apaga — erro do
 * modelo se desfaz no app, o contrário não. Então esta ação é recusada.
 */
export function isDestructive(action: CopilotQuickAction): boolean {
  return action.effects.some((e) => e.kind === "delete_next_step")
}

const input = z.object({
  question_key: z
    .string()
    .min(1)
    .describe("Copie exatamente o question_key devolvido por whats_stuck."),
  action_id: z
    .string()
    .min(1)
    .describe("O id de uma das suggested_answers daquela pendência."),
})

export const answerWithAction: McpTool<typeof input> = {
  name: "answer_with_action",
  description:
    "Responde uma pendência de whats_stuck escolhendo uma das respostas prontas " +
    "que ela oferece. Aplica exatamente o que o app aplicaria naquele botão e tira " +
    "a pergunta da fila, numa chamada só. PREFIRA esta tool quando alguma das " +
    "suggested_answers descreve o que aconteceu — só caia nas tools de escrita " +
    "quando nenhuma servir.",
  input,
  async handler({ supabase, workspaceId, userId }, args) {
    const snap = await fetchPipelineSnapshot(supabase, {
      includeActivities: true,
      includePeople: true,
    })

    const today = new Date().toISOString().slice(0, 10)
    const { data: events } = await supabase
      .from("copilot_question_events")
      .select("question_key")
      .gte("suppress_until", today)

    const suppressed = new Set((events ?? []).map((e) => e.question_key as string))

    // Tetos generosos de propósito. Os padrões (6 contas, 4 por conta) existem
    // para o card não virar parede; aqui eles causariam recusa falsa — uma
    // pendência real que o modelo acabou de ver ficaria fora do corte se o
    // pipeline mexeu, e a tool diria "não existe mais" mentindo.
    const question = detectQuestions(snap, suppressed, {
      limit: 500,
      maxPerCompany: 50,
    }).find((q) => q.key === args.question_key)

    // Recalcular é obrigatório: os efeitos vêm amarrados a ids concretos
    // (stepId), e entre o whats_stuck e esta chamada a outra pessoa do
    // workspace pode ter mexido no card. Aplicar efeito de uma pergunta que
    // não existe mais seria escrever no passado.
    if (!question) {
      throw new Error(
        "Essa pendência não está mais na fila. Pode ter sido tratada por outra " +
          "pessoa, ou a empresa mudou de estágio. Chame whats_stuck de novo."
      )
    }

    const action = question.actions.find((a) => a.id === args.action_id)
    if (!action) {
      const opcoes = question.actions.map((a) => a.id).join(", ")
      throw new Error(`Ação "${args.action_id}" não existe nessa pendência. Opções: ${opcoes}`)
    }

    if (isDestructive(action)) {
      throw new Error(
        `A opção "${action.label}" apaga o próximo passo, e nenhuma tool do MCP ` +
          "apaga. Faça isso no app, ou escolha outra opção."
      )
    }

    for (const effect of action.effects) {
      await applyEffect(
        supabase,
        { workspaceId, userId, companyId: question.companyId, snapshot: snap },
        effect
      )
    }

    await recordCopilotEvent(supabase, {
      workspaceId,
      userId,
      companyId: question.companyId,
      questionKey: question.key,
      ruleId: question.ruleId,
      status: "answered",
      suppressDays: action.suppressDays,
      actionId: action.id,
      applied: { action: action.id, label: action.label, effects: action.effects },
    })

    return {
      company: question.companyName,
      answered: question.title,
      action: action.label,
      hidden_for_days: action.suppressDays,
    }
  },
}
