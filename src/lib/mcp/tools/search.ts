import { z } from "zod"
import type { McpTool } from "../registry"

const input = z.object({
  query: z.string().min(1).describe("Trecho do nome da pessoa ou da empresa."),
  type: z
    .enum(["all", "people", "companies"])
    .default("all")
    .describe("Restringe a busca a um dos dois."),
})

export const search: McpTool<typeof input> = {
  name: "search",
  description:
    "Busca pessoas e empresas por nome e devolve os ids. Use SEMPRE que precisar de um " +
    "company_id ou person_id e só tiver o nome — nenhuma outra tool aceita nome no lugar do id.",
  input,
  async handler({ supabase }, { query, type }) {
    const pattern = `%${query}%`
    const out: { people: unknown[]; companies: unknown[] } = { people: [], companies: [] }

    if (type === "all" || type === "people") {
      const { data } = await supabase
        .from("people")
        .select("id, full_name, current_title, current_company, company_id")
        .ilike("full_name", pattern)
        .limit(20)
      out.people = data ?? []
    }

    if (type === "all" || type === "companies") {
      const { data } = await supabase
        .from("companies")
        .select("id, name, industry, kanban_column_id")
        .ilike("name", pattern)
        .limit(20)
      out.companies = data ?? []
    }

    return out
  },
}
