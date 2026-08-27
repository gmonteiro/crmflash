import { z } from "zod"
import type { SupabaseClient } from "@supabase/supabase-js"
import { personDedupKey } from "@/lib/import/dedup-key"
import type { McpTool } from "../registry"

const input = z.object({
  first_name: z.string().trim().min(1),
  last_name: z.string().trim().min(1),
  current_title: z.string().nullable().default(null).describe("Cargo, se souber."),
  current_company: z
    .string()
    .nullable()
    .default(null)
    .describe("Nome da empresa. Entra na chave de deduplicação."),
  company_id: z
    .string()
    .uuid()
    .nullable()
    .default(null)
    .describe("Vincula a pessoa a uma empresa já cadastrada."),
  email: z.string().email().nullable().default(null),
})

export const findOrCreatePerson: McpTool<typeof input> = {
  name: "find_or_create_person",
  description:
    "Devolve o id de uma pessoa, criando-a se não existir. A chave é nome + sobrenome + " +
    "cargo + empresa, a mesma do import de planilha — então informe cargo e empresa " +
    "sempre que souber, ou a mesma pessoa vira dois cadastros.",
  input,
  async handler({ supabase, workspaceId, userId }, args) {
    // dedup_key é coluna gerada (migration 015) com índice ÚNICO em
    // (workspace_id, dedup_key). Consultar por ela é a única busca que não pode
    // divergir do que o banco considera duplicata — buscar por nome e comparar
    // depois erraria em homônimo além do limite, ou em nome com % e _, e aí o
    // insert bateria no índice e a tool estouraria em vez de deduplicar.
    const key = personDedupKey(args)

    const existing = await findByDedupKey(supabase, key)
    if (existing) return { created: false, ...existing }

    const { data: inserted, error } = await supabase
      .from("people")
      .insert({
        workspace_id: workspaceId,
        user_id: userId,
        first_name: args.first_name.trim(),
        last_name: args.last_name.trim(),
        current_title: args.current_title,
        current_company: args.current_company,
        company_id: args.company_id,
        email: args.email,
      })
      .select("id, full_name")
      .single()

    if (error) {
      // 23505 = unique_violation. Alguém inseriu entre a busca e o insert, ou a
      // pessoa existe num estado que a busca não alcançou. Nos dois casos o
      // destino certo é a linha que já está lá, não um erro na cara do usuário.
      if (error.code === "23505") {
        const raced = await findByDedupKey(supabase, key)
        if (raced) return { created: false, ...raced }
      }
      throw new Error(`Não consegui criar a pessoa: ${error.message}`)
    }

    return { created: true, person_id: inserted.id, name: inserted.full_name }
  },
}

async function findByDedupKey(
  supabase: SupabaseClient,
  key: string
): Promise<{ person_id: string; name: string } | null> {
  const { data } = await supabase
    .from("people")
    .select("id, full_name")
    .eq("dedup_key", key)
    .maybeSingle()

  return data ? { person_id: data.id, name: data.full_name } : null
}
