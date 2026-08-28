import { z } from "zod"
import { memberColumn, checkEntityMatches, type ShortlistEntityType } from "../shortlists"
import type { McpTool } from "../registry"

const input = z.object({
  shortlist_id: z.string().uuid().describe("Vem de list_shortlists."),
  entity_id: z
    .string()
    .uuid()
    .describe("Id da pessoa ou da empresa, conforme o tipo da lista."),
  member: z.boolean().describe("true entra na lista, false sai."),
})

export const setShortlistMembership: McpTool<typeof input> = {
  name: "set_shortlist_membership",
  description:
    "Põe ou tira alguém de uma shortlist. Tirar da lista NÃO APAGA a pessoa nem a " +
    "empresa — desfaz só o vínculo, e pôr de volta restaura idêntico. Idempotente: " +
    "entrar duas vezes não duplica, sair de quem não está não é erro.",
  input,
  async handler({ supabase }, args) {
    const { data: list } = await supabase
      .from("shortlists")
      .select("id, name, entity_type")
      .eq("id", args.shortlist_id)
      .maybeSingle()

    if (!list) throw new Error(`Shortlist ${args.shortlist_id} não encontrada.`)

    const entityType = list.entity_type as ShortlistEntityType
    const column = memberColumn(entityType)

    // Descobre o que o id é de fato. As duas leituras em paralelo porque o id
    // pode ser qualquer um dos dois, e é justamente isso que precisa ser
    // conferido — o banco aceitaria empresa numa lista de pessoas.
    const [personRes, companyRes] = await Promise.all([
      supabase.from("people").select("id, full_name").eq("id", args.entity_id).maybeSingle(),
      supabase.from("companies").select("id, name").eq("id", args.entity_id).maybeSingle(),
    ])

    const check = checkEntityMatches(entityType, {
      person: Boolean(personRes.data),
      company: Boolean(companyRes.data),
    })
    if (!check.ok) throw new Error(`"${list.name}" ${check.reason}.`)

    const nome =
      (personRes.data as { full_name: string } | null)?.full_name ??
      (companyRes.data as { name: string } | null)?.name ??
      args.entity_id

    if (!args.member) {
      await supabase
        .from("shortlist_members")
        .delete()
        .eq("shortlist_id", args.shortlist_id)
        .eq(column, args.entity_id)

      return { shortlist: list.name, entity: nome, member: false }
    }

    // Idempotência: a tabela não tem índice único em (shortlist_id, entity),
    // então entrar duas vezes duplicaria a linha se não checasse antes.
    const { data: existing } = await supabase
      .from("shortlist_members")
      .select("id")
      .eq("shortlist_id", args.shortlist_id)
      .eq(column, args.entity_id)
      .maybeSingle()

    if (existing) {
      return { shortlist: list.name, entity: nome, member: true, already: true }
    }

    // Sem workspace_id: esta tabela não tem a coluna. A RLS dela é derivada,
    // por subquery na shortlist dona — mesmo padrão de people_tags. Não
    // acrescente o campo "por consistência": o insert falha.
    const { error } = await supabase.from("shortlist_members").insert({
      shortlist_id: args.shortlist_id,
      [column]: args.entity_id,
    })

    if (error) throw new Error(`Não consegui alterar a lista: ${error.message}`)

    return { shortlist: list.name, entity: nome, member: true }
  },
}
