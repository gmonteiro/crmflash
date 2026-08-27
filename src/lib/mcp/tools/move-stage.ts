import { z } from "zod"
import { fetchPipelineSnapshot } from "@/lib/pipeline/snapshot"
import { colById, isTerminal } from "@/lib/pipeline/stages"
import { applyEffect } from "@/lib/pipeline/effects"
import type { McpTool } from "../registry"

const input = z
  .object({
    company_id: z.string().uuid(),
    target: z
      .enum(["next", "prev", "title"])
      .describe("next avança um estágio, prev volta um, title vai para um nomeado."),
    stage_title: z
      .string()
      .optional()
      .describe("Obrigatório quando target = title. Use o título exato do estágio."),
  })
  .refine((v) => v.target !== "title" || Boolean(v.stage_title), {
    message: "target = title exige stage_title.",
  })

export const moveStage: McpTool<typeof input> = {
  name: "move_stage",
  description:
    "Move a empresa de estágio no funil. Avançar conta como evento do cliente e reseta o " +
    "contador de dias sem contato — então só avance quando o CLIENTE deu o passo, não " +
    "quando você mandou algo. Confirme com a pessoa antes de chamar: é a única escrita " +
    "que muda a posição da conta no funil.",
  input,
  async handler({ supabase, workspaceId, userId }, args) {
    const snap = await fetchPipelineSnapshot(supabase)
    const company = snap.companies.find((c) => c.id === args.company_id)
    if (!company) throw new Error(`Empresa ${args.company_id} não está no board.`)

    const from = colById(snap.columns).get(company.kanban_column_id) ?? null
    if (from && isTerminal(from.title)) {
      throw new Error(
        `A empresa está em "${from.title}", que é estágio terminal. Reabrir uma conta ` +
          `fechada é decisão de quem opera — faça isso no app.`
      )
    }

    await applyEffect(
      supabase,
      { workspaceId, userId, companyId: args.company_id, snapshot: snap },
      { kind: "move_stage", target: args.target, title: args.stage_title }
    )

    // Releitura: applyEffect não devolve o destino, e confirmar o estado final
    // vale mais para o modelo do que ecoar o que foi pedido.
    const after = await fetchPipelineSnapshot(supabase)
    const moved = after.companies.find((c) => c.id === args.company_id)
    const to = moved ? (colById(after.columns).get(moved.kanban_column_id) ?? null) : null

    return { company: company.name, from: from?.title ?? null, to: to?.title ?? null }
  },
}
