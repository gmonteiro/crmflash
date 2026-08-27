import { z } from "zod"
import type { McpIdentity } from "./identity"
import { pipelineOverview } from "./tools/pipeline-overview"
import { whatsStuck } from "./tools/whats-stuck"
import { companySituation } from "./tools/company-situation"
import { agenda } from "./tools/agenda"
import { search } from "./tools/search"
import { logActivity } from "./tools/log-activity"
import { setNextStep } from "./tools/set-next-step"
import { completeNextStep } from "./tools/complete-next-step"
import { moveStage } from "./tools/move-stage"
import { captureSignal } from "./tools/capture-signal"
import { setCompanyContext } from "./tools/set-company-context"
import { answerCopilotQuestion } from "./tools/answer-copilot-question"

export interface McpTool<S extends z.ZodType = z.ZodType> {
  name: string
  /** O Claude decide quando chamar lendo isto. Diga QUANDO usar, não só o quê faz. */
  description: string
  input: S
  handler(identity: McpIdentity, args: z.infer<S>): Promise<unknown>
}

/**
 * McpTool sem o genérico, para o array poder ser heterogêneo.
 *
 * O `never` no parâmetro do handler não é decorativo: parâmetro de função é
 * contravariante, então McpTool<SchemaEspecífico> NÃO é atribuível a
 * McpTool<z.ZodType> — mas é atribuível a esta, porque `never` é atribuível a
 * qualquer tipo. Quem chama o handler faz o cast, uma vez, na rota.
 */
export type AnyMcpTool = {
  name: string
  description: string
  input: z.ZodType
  handler(identity: McpIdentity, args: never): Promise<unknown>
}

// Ordem importa: o Claude lê o tools/list de cima para baixo, e whats_stuck é a
// porta de entrada pretendida.
export const TOOLS: AnyMcpTool[] = [
  whatsStuck,
  companySituation,
  pipelineOverview,
  agenda,
  search,
  logActivity,
  setNextStep,
  completeNextStep,
  moveStage,
  captureSignal,
  setCompanyContext,
  answerCopilotQuestion,
]

export function findTool(name: string): AnyMcpTool | undefined {
  return TOOLS.find((t) => t.name === name)
}

export function toolListPayload() {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.input),
  }))
}
