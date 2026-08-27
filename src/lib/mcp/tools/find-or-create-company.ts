import { z } from "zod"
import { companyDedupKey } from "@/lib/import/dedup-key"
import type { McpTool } from "../registry"

const input = z.object({
  name: z.string().trim().min(1).describe("Nome da empresa, como o cliente se chama."),
})

export const findOrCreateCompany: McpTool<typeof input> = {
  name: "find_or_create_company",
  description:
    "Devolve o id de uma empresa pelo nome, criando-a se ainda não existir. Use quando a " +
    "pessoa mencionar uma empresa que search não encontrou. A comparação ignora " +
    "maiúsculas e espaços, mas não variações de razão social — 'Acme' e 'Acme Ltda' viram " +
    "duas empresas, então prefira o nome que a pessoa já usa.",
  input,
  async handler({ supabase, workspaceId, userId }, { name }) {
    const key = companyDedupKey(name)

    const { data: candidates } = await supabase
      .from("companies")
      .select("id, name")
      .ilike("name", name)
      .limit(50)

    const match = (candidates ?? []).find(
      (c) => companyDedupKey(c.name as string) === key
    )
    if (match) return { created: false, company_id: match.id, name: match.name }

    const { data: inserted, error } = await supabase
      .from("companies")
      .insert({ workspace_id: workspaceId, user_id: userId, name: name.trim() })
      .select("id, name")
      .single()

    if (error) throw new Error(`Não consegui criar a empresa: ${error.message}`)

    return { created: true, company_id: inserted.id, name: inserted.name }
  },
}
