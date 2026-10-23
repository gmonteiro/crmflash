import { z } from "zod"
import type { SupabaseClient } from "@supabase/supabase-js"
import { personDedupKey } from "@/lib/import/dedup-key"
import { namesCompatible, normalizeEmail } from "@/lib/identity/normalize"
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
  email: z
    .string()
    .email()
    .nullable()
    .default(null)
    .describe("Se souber, informe: e-mail é chave forte e vence nome, cargo e empresa."),
})

export const findOrCreatePerson: McpTool<typeof input> = {
  name: "find_or_create_person",
  description:
    "Devolve o id de uma pessoa, criando-a se não existir. Ordem do match: e-mail já " +
    "conhecido (chave forte); depois nome + sobrenome + cargo + empresa, a mesma chave " +
    "do import de planilha; e, com company_id, o mesmo nome na mesma empresa mesmo sem " +
    "cargo. Informe e-mail, cargo e empresa sempre que souber.",
  input,
  async handler({ supabase, workspaceId, userId }, args) {
    const email = normalizeEmail(args.email)

    // 1. E-mail conhecido (020): a mesma pessoa com outro cargo não vira outra.
    if (email) {
      const { data: known } = await supabase
        .from("person_identities")
        .select("person_id")
        .eq("kind", "email")
        .eq("value_norm", email)
        .maybeSingle()
      if (known?.person_id) {
        const { data: p } = await supabase.from("people").select("id, full_name").eq("id", known.person_id).maybeSingle()
        if (p) return { created: false, person_id: p.id, name: p.full_name, matched_by: "email" }
      }
    }

    // 2. dedup_key é coluna gerada (migration 015) com índice ÚNICO em
    // (workspace_id, dedup_key). Consultar por ela é a única busca que não pode
    // divergir do que o banco considera duplicata — buscar por nome e comparar
    // depois erraria em homônimo além do limite, ou em nome com % e _, e aí o
    // insert bateria no índice e a tool estouraria em vez de deduplicar.
    const key = personDedupKey(args)

    const existing = await findByDedupKey(supabase, key)
    if (existing) {
      await rememberEmail(supabase, workspaceId, existing.person_id, email)
      return { created: false, ...existing }
    }

    // 3. Mesmo nome na mesma empresa, com ou sem cargo: "Ana Silva" e "Ana
    // Silva, CTO" na Acme são a mesma pessoa. O dedup_key não vê isso porque o
    // cargo está na chave.
    if (args.company_id) {
      const { data: sameCompany } = await supabase
        .from("people")
        .select("id, full_name")
        .eq("company_id", args.company_id)
        .limit(500)
      const full = `${args.first_name} ${args.last_name}`
      const hits = (sameCompany ?? []).filter((p) => {
        const a = (p.full_name as string).split(/\s+/)
        return namesCompatible(full, p.full_name as string) && a.length > 1 && a[a.length - 1].length > 1
      })
      if (hits.length === 1) {
        await rememberEmail(supabase, workspaceId, hits[0].id as string, email)
        return { created: false, person_id: hits[0].id, name: hits[0].full_name, matched_by: "name_in_company" }
      }
    }

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

    await rememberEmail(supabase, workspaceId, inserted.id, email)
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

/**
 * Grava o e-mail como identidade, para a ingestão (Calendar, Gmail) achar esta
 * pessoa pelo degrau 1. Já pertencer a outra pessoa não é erro aqui: o índice
 * único recusa, e quem resolve é a fila, não esta tool.
 */
async function rememberEmail(
  supabase: SupabaseClient,
  workspaceId: string,
  personId: string,
  email: string | null
): Promise<void> {
  if (!email) return
  await supabase.from("person_identities").insert({
    workspace_id: workspaceId,
    person_id: personId,
    kind: "email",
    value_norm: email,
    value_raw: email,
    source: "mcp",
    confidence: "strong",
  })
}
