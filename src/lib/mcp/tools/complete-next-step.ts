import { z } from "zod"
import { applyEffect } from "@/lib/pipeline/effects"
import type { McpTool } from "../registry"

const input = z.object({
  company_id: z.string().uuid(),
  next_step_id: z.string().uuid().describe("Vem de agenda ou de company_situation."),
})

export const completeNextStep: McpTool<typeof input> = {
  name: "complete_next_step",
  description:
    "Marca um próximo passo como concluído. Concluir uma tarefa é ação SUA, não do " +
    "cliente — esta tool nunca mexe no contador de dias sem contato. Se o cliente " +
    "respondeu, registre isso com log_activity.",
  input,
  async handler({ supabase, workspaceId, userId }, args) {
    await applyEffect(
      supabase,
      { workspaceId, userId, companyId: args.company_id, snapshot: null },
      { kind: "complete_next_step", stepId: args.next_step_id }
    )

    return { completed: true, next_step_id: args.next_step_id }
  },
}
