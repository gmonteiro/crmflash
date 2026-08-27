import { z } from "zod"
import { applyEffect } from "@/lib/pipeline/effects"
import type { McpTool } from "../registry"

const input = z
  .object({
    company_id: z.string().uuid(),
    title: z.string().min(1).describe("O compromisso, na voz de quem vai executar."),
    due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Data exata, yyyy-MM-dd. Tem precedência sobre in_days."),
    in_days: z.number().int().min(0).max(365).optional().describe("Prazo relativo a hoje."),
  })
  .refine((v) => Boolean(v.due_date || v.in_days !== undefined), {
    message: "Informe due_date ou in_days.",
  })

export const setNextStep: McpTool<typeof input> = {
  name: "set_next_step",
  description:
    "Cria um próximo passo com prazo para uma empresa, e registra a criação na timeline. " +
    "Use sempre que a conversa terminar com um compromisso — uma conta sem próximo passo " +
    "vira pendência do copiloto no dia seguinte. NÃO marca evento do cliente.",
  input,
  async handler({ supabase, workspaceId, userId }, args) {
    await applyEffect(
      supabase,
      { workspaceId, userId, companyId: args.company_id, snapshot: null },
      {
        kind: "create_next_step",
        title: args.title,
        dueDate: args.due_date,
        inDays: args.in_days,
      }
    )

    return { created: true, title: args.title }
  },
}
