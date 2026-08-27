import { z } from "zod"
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
    const key = personDedupKey(args)

    const { data: candidates } = await supabase
      .from("people")
      .select("id, full_name, first_name, last_name, current_title, current_company")
      .ilike("full_name", `${args.first_name} ${args.last_name}`)
      .limit(50)

    const match = (candidates ?? []).find(
      (p) => personDedupKey(p as Parameters<typeof personDedupKey>[0]) === key
    )
    if (match) return { created: false, person_id: match.id, name: match.full_name }

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

    if (error) throw new Error(`Não consegui criar a pessoa: ${error.message}`)

    return { created: true, person_id: inserted.id, name: inserted.full_name }
  },
}
