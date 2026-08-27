import { z } from "zod"
import { applyEffect } from "@/lib/pipeline/effects"
import type { McpTool } from "../registry"

const input = z.object({
  company_id: z.string().uuid(),
  type: z.enum(["meeting", "call", "email", "note"]),
  title: z.string().min(1).describe("Uma linha. É o que aparece na timeline."),
  description: z.string().nullable().default(null).describe("O relato completo, se houver."),
  client_engaged: z
    .boolean()
    .describe(
      "true SOMENTE se o CLIENTE fez algo: respondeu, apareceu na reunião, mandou dado, " +
        "pediu preço. false quando foi você que agiu: cobrou, mandou follow-up, ou a " +
        "reunião não aconteceu. Este campo controla o contador de dias sem contato — " +
        "marcar true por engano faz uma conta morta parecer viva."
    ),
})

export const logActivity: McpTool<typeof input> = {
  name: "log_activity",
  description:
    "Registra uma reunião, ligação, e-mail ou nota na timeline de uma empresa. Use " +
    "depois que a pessoa narrar o que aconteceu. Chame company_situation antes se " +
    "precisar do contexto da conta.",
  input,
  async handler({ supabase, workspaceId, userId }, args) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    // Idempotência: o modelo repetir a chamada não pode virar duas reuniões.
    const { data: existing } = await supabase
      .from("company_activities")
      .select("id")
      .eq("company_id", args.company_id)
      .eq("type", args.type)
      .eq("title", args.title)
      .gte("date", since)
      .maybeSingle()

    if (existing) {
      return { deduplicated: true, activity_id: existing.id }
    }

    const now = new Date().toISOString()
    const { data: inserted } = await supabase
      .from("company_activities")
      .insert({
        workspace_id: workspaceId,
        user_id: userId,
        company_id: args.company_id,
        type: args.type,
        title: args.title,
        description: args.description,
        date: now,
      })
      .select("id")
      .single()

    if (args.client_engaged) {
      await applyEffect(
        supabase,
        { workspaceId, userId, companyId: args.company_id, snapshot: null },
        { kind: "mark_client_event" }
      )
    }

    return {
      deduplicated: false,
      activity_id: inserted?.id ?? null,
      client_event_marked: args.client_engaged,
    }
  },
}
