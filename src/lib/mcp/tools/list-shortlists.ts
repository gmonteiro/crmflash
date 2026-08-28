import { z } from "zod"
import type { McpTool } from "../registry"

const input = z.object({})

export const listShortlists: McpTool<typeof input> = {
  name: "list_shortlists",
  description:
    "As listas de trabalho do CRM, com quantas pessoas ou empresas cada uma tem. " +
    "Use quando a pessoa falar de uma lista pelo nome — 'quem está na CFO?' — para " +
    "descobrir o id antes de chamar shortlist_members.",
  input,
  async handler({ supabase }) {
    const { data } = await supabase
      .from("shortlists")
      .select("id, name, entity_type, description, shortlist_members(count)")
      .order("name")

    return (data ?? []).map((row) => {
      const counts = row.shortlist_members as unknown as { count: number }[] | null
      return {
        shortlist_id: row.id,
        name: row.name,
        entity_type: row.entity_type,
        description: row.description,
        members: counts?.[0]?.count ?? 0,
      }
    })
  },
}
