import { z } from "zod"
import type { McpTool } from "../registry"

const LIMIT = 500

const input = z.object({
  shortlist_id: z.string().uuid().describe("Vem de list_shortlists."),
})

export const shortlistMembers: McpTool<typeof input> = {
  name: "shortlist_members",
  description:
    "Quem está numa shortlist. Para lista de pessoas devolve nome, cargo e empresa; " +
    "para lista de empresas, nome e estágio no funil. Chame list_shortlists antes " +
    "para descobrir o id.",
  input,
  async handler({ supabase }, { shortlist_id }) {
    const { data: list } = await supabase
      .from("shortlists")
      .select("id, name, entity_type")
      .eq("id", shortlist_id)
      .maybeSingle()

    if (!list) throw new Error(`Shortlist ${shortlist_id} não encontrada.`)

    const { data } = await supabase
      .from("shortlist_members")
      .select(
        "id, added_at, people(id, full_name, current_title, current_company), companies(id, name, kanban_column_id)"
      )
      .eq("shortlist_id", shortlist_id)
      .order("added_at", { ascending: false })
      .limit(LIMIT)

    const rows = data ?? []

    const members = rows.map((m) => {
      const person = m.people as unknown as {
        id: string
        full_name: string
        current_title: string | null
        current_company: string | null
      } | null
      const company = m.companies as unknown as { id: string; name: string } | null

      return person
        ? {
            member_id: m.id,
            person_id: person.id,
            name: person.full_name,
            title: person.current_title,
            company: person.current_company,
            added_at: m.added_at,
          }
        : {
            member_id: m.id,
            company_id: company?.id ?? null,
            name: company?.name ?? "(removida)",
            added_at: m.added_at,
          }
    })

    return {
      shortlist_id: list.id,
      name: list.name,
      entity_type: list.entity_type,
      members,
      // Teto explícito no retorno: uma lista cortada em silêncio faria o modelo
      // afirmar "são 500" com confiança sobre uma lista de 800.
      truncated: rows.length === LIMIT,
    }
  },
}
