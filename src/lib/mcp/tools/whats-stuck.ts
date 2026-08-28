import { z } from "zod"
import { fetchPipelineSnapshot } from "@/lib/pipeline/snapshot"
import { detectQuestions } from "@/lib/pipeline/rules"
import { buildCompanyQueue } from "@/lib/pipeline/queue"
import type { CopilotQuickAction } from "@/types/copilot"
import { isDestructive } from "./answer-with-action"
import type { McpTool } from "../registry"

export interface OfferedAction {
  id: string
  label: string
  suppress_days: number
  /** A ação existe no app mas answer_with_action recusa: ela apaga. */
  only_in_app: boolean
}

// Ação de rascunho fica de fora: ela só abre um painel, não escreve nada e tem
// suppressDays 0. No chat o Claude redige o texto direto, sem tool nenhuma.
//
// A destrutiva CONTINUA listada, marcada. Esconder seria pior: você veria
// quatro opções no app e três no chat, sem explicação nenhuma.
export function offerableActions(actions: CopilotQuickAction[]): OfferedAction[] {
  return actions
    .filter((a) => !a.effects.some((e) => e.kind === "open_drafts"))
    .map((a) => ({
      id: a.id,
      label: a.label,
      suppress_days: a.suppressDays,
      only_in_app: isDestructive(a),
    }))
}

const input = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Teto de empresas na fila. Sem valor, usa o mesmo do painel."),
})

export const whatsStuck: McpTool<typeof input> = {
  name: "whats_stuck",
  description:
    "A fila do copiloto: o que está estranho no pipeline agora, agrupado por empresa e " +
    "ordenado por urgência. Use como PRIMEIRA chamada quando a pessoa perguntar o que " +
    "precisa de atenção, o que está parado, ou por onde começar o dia. Cada pendência " +
    "traz um question_key — guarde-o para responder com answer_copilot_question.",
  input,
  async handler({ supabase }, { limit }) {
    const snap = await fetchPipelineSnapshot(supabase, {
      includeActivities: true,
      includePeople: true,
    })

    // Chaves ainda suprimidas: perguntas já respondidas não voltam à fila.
    const today = new Date().toISOString().slice(0, 10)
    const { data: events } = await supabase
      .from("copilot_question_events")
      .select("question_key")
      .gte("suppress_until", today)

    const suppressed = new Set((events ?? []).map((e) => e.question_key as string))
    const questions = detectQuestions(snap, suppressed, limit ? { limit } : {})

    return buildCompanyQueue(questions).map((item) => ({
      company_id: item.companyId,
      company: item.companyName,
      stage: item.stageTitle,
      priority: item.priority,
      pendings: item.pendings.map((q) => ({
        question_key: q.key,
        rule_id: q.ruleId,
        title: q.title,
        subtitle: q.subtitle ?? null,
        suggested_answers: offerableActions(q.actions),
      })),
    }))
  },
}
