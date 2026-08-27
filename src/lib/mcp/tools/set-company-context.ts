import { z } from "zod"
import { applyEffect } from "@/lib/pipeline/effects"
import type { McpTool } from "../registry"

const input = z
  .object({
    company_id: z.string().uuid(),
    champion_name: z
      .string()
      .optional()
      .describe("Quem, dentro do cliente, quer que isso aconteça."),
    economic_buyer_name: z.string().optional().describe("Quem assina o cheque."),
    pain_hypothesis: z
      .string()
      .optional()
      .describe("A dor que o cliente tem, na linguagem dele."),
  })
  .refine(
    (v) => Boolean(v.champion_name || v.economic_buyer_name || v.pain_hypothesis),
    { message: "Informe pelo menos um campo." }
  )

export const setCompanyContext: McpTool<typeof input> = {
  name: "set_company_context",
  description:
    "Preenche champion, comprador econômico e hipótese de dor de uma empresa. São os três " +
    "campos que o copiloto cobra quando a conta avança sem eles. NÃO é evento do cliente: " +
    "descobrir quem é o champion não reseta o contador de dias sem contato.",
  input,
  async handler({ supabase, workspaceId, userId }, args) {
    const ctx = {
      workspaceId,
      userId,
      companyId: args.company_id,
      snapshot: null,
    }

    const fields = [
      ["champion_name", args.champion_name],
      ["economic_buyer_name", args.economic_buyer_name],
      ["pain_hypothesis", args.pain_hypothesis],
    ] as const

    const written: string[] = []
    for (const [field, value] of fields) {
      if (!value) continue
      await applyEffect(supabase, ctx, { kind: "set_field", field, value })
      written.push(field)
    }

    return { updated: written }
  },
}
