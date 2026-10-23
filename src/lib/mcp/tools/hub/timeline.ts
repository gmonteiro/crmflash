import { z } from "zod"
import type { McpTool } from "../../registry"

const input = z.object({
  company_id: z.string().uuid(),
  limit: z.number().int().min(1).max(100).default(30),
})

export const timeline: McpTool<typeof input> = {
  name: "timeline",
  description:
    "A linha do tempo unificada de uma empresa: convites, reuniões, transcrições e " +
    "registros manuais, do mais recente para o mais antigo. Cada evento diz se foi " +
    "AÇÃO DO CLIENTE (client_engaged) e qual regra decidiu isso (engagement_rule). Use " +
    "para responder por que uma conta parece viva ou morta.",
  input,
  async handler({ supabase }, { company_id, limit }) {
    const [hub, manual] = await Promise.all([
      supabase
        .from("activities")
        .select("id, kind, type, title, occurred_at, date, source, client_engaged, engagement_rule, source_app_url, evidence")
        .eq("company_id", company_id)
        .order("date", { ascending: false })
        .limit(limit),
      supabase
        .from("company_activities")
        .select("id, type, title, description, date")
        .eq("company_id", company_id)
        .order("date", { ascending: false })
        .limit(limit),
    ])

    const rows = [
      ...(hub.data ?? []).map((a) => ({
        id: a.id as string,
        when: (a.occurred_at ?? a.date) as string,
        kind: (a.kind ?? a.type) as string,
        title: a.title as string,
        source: a.source as string,
        client_engaged: (a.client_engaged as boolean | null) ?? null,
        engagement_rule: (a.engagement_rule as string | null) ?? null,
        link: (a.source_app_url as string | null) ?? (a.evidence as { url?: string }[] | null)?.[0]?.url ?? null,
      })),
      ...(manual.data ?? []).map((a) => ({
        id: a.id as string,
        when: a.date as string,
        kind: a.type as string,
        title: a.title as string,
        source: "manual",
        // company_activities é anterior à 019 e não guarda quem agiu.
        client_engaged: null,
        engagement_rule: null,
        link: null,
      })),
    ]
    rows.sort((x, y) => new Date(y.when).getTime() - new Date(x.when).getTime())
    return { company_id, events: rows.slice(0, limit) }
  },
}
