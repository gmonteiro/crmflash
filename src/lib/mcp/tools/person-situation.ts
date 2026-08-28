import { z } from "zod"
import type { McpTool } from "../registry"

const input = z.object({
  person_id: z.string().uuid().describe("Id da pessoa. Use search para descobrir."),
})

export const personSituation: McpTool<typeof input> = {
  name: "person_situation",
  description:
    "Dossiê de UMA pessoa: cargo, empresa vinculada, e-mail, telefone, LinkedIn, " +
    "categoria, notas, donos do contato e as shortlists de que ela participa. " +
    "NÃO tem timeline — o histórico de interação fica na empresa, em " +
    "company_situation. Use depois de search, quando precisar de mais que o nome.",
  input,
  async handler({ supabase }, { person_id }) {
    const { data: person } = await supabase
      .from("people")
      // Uma linha só, sem concatenar: o supabase-js infere o tipo do retorno a
      // partir do literal do select, e uma string montada com + vira opaca.
      .select(
        "id, full_name, email, phone, linkedin_url, current_title, current_company, company_id, category, notes, linkedin_enriched_at"
      )
      .eq("id", person_id)
      .maybeSingle()

    if (!person) throw new Error(`Pessoa ${person_id} não encontrada.`)

    // Empresa, shortlists e donos em paralelo: são três leituras independentes
    // e o dossiê é caminho de leitura pura.
    const [companyRes, listsRes, ownersRes] = await Promise.all([
      person.company_id
        ? supabase
            .from("companies")
            .select("id, name, kanban_column_id")
            .eq("id", person.company_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("shortlist_members")
        .select("shortlist_id, added_at, shortlists(id, name)")
        .eq("person_id", person_id),
      supabase.from("people_owners").select("user_id").eq("person_id", person_id),
    ])

    const company = companyRes.data as { id: string; name: string } | null

    return {
      person_id: person.id,
      name: person.full_name,
      title: person.current_title,
      // current_company é texto livre vindo do import; company_id é o vínculo
      // de verdade. Devolver os dois deixa a divergência visível.
      company_text: person.current_company,
      company: company ? { id: company.id, name: company.name } : null,
      email: person.email,
      phone: person.phone,
      linkedin_url: person.linkedin_url,
      category: person.category,
      notes: person.notes,
      last_enriched_at: person.linkedin_enriched_at,
      owners: (ownersRes.data ?? []).map((o) => o.user_id as string),
      shortlists: (listsRes.data ?? []).map((m) => {
        const sl = m.shortlists as unknown as { id: string; name: string } | null
        return { id: sl?.id ?? m.shortlist_id, name: sl?.name ?? "(lista removida)" }
      }),
    }
  },
}
