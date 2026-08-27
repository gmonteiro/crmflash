import { z } from "zod"
import { addDays, format } from "date-fns"
import type { McpTool } from "../registry"

const DATE_FMT = "yyyy-MM-dd"

const input = z.object({
  window: z
    .enum(["overdue", "today", "week"])
    .default("week")
    .describe("overdue = vencidos; today = vencem hoje; week = próximos 7 dias."),
})

export const agenda: McpTool<typeof input> = {
  name: "agenda",
  description:
    "Próximos passos pendentes por janela de tempo, com a empresa de cada um. Use " +
    "quando a pergunta for sobre compromissos, prazos, o que vence, ou o que ficou " +
    "atrasado — em vez de varrer empresa por empresa.",
  input,
  async handler({ supabase }, { window }) {
    const today = format(new Date(), DATE_FMT)

    let query = supabase
      .from("company_next_steps")
      .select("id, title, due_date, company_id, companies(id, name)")
      .eq("status", "pending")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(200)

    if (window === "overdue") query = query.lt("due_date", today)
    else if (window === "today") query = query.eq("due_date", today)
    else
      query = query
        .gte("due_date", today)
        .lte("due_date", format(addDays(new Date(), 7), DATE_FMT))

    const { data } = await query

    return (data ?? []).map((row) => {
      const company = row.companies as unknown as { id: string; name: string } | null
      return {
        next_step_id: row.id,
        title: row.title,
        due_date: row.due_date,
        company_id: row.company_id,
        company: company?.name ?? null,
        overdue: Boolean(row.due_date && row.due_date < today),
      }
    })
  },
}
