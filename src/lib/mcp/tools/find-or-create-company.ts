import { z } from "zod"
import { companyDedupKey } from "@/lib/import/dedup-key"
import { companyNameKey, isFreeMailDomain, normalizeDomain } from "@/lib/identity/normalize"
import type { McpTool } from "../registry"

const input = z.object({
  name: z.string().trim().min(1).describe("Nome da empresa, como o cliente se chama."),
  domain: z
    .string()
    .trim()
    .nullable()
    .default(null)
    .describe("Site ou domínio de e-mail (acme.com.br). Se souber, informe: é a chave mais forte."),
})

export const findOrCreateCompany: McpTool<typeof input> = {
  name: "find_or_create_company",
  description:
    "Devolve o id de uma empresa, criando-a se ainda não existir. Ordem do match: domínio " +
    "já ligado a uma empresa; depois o nome normalizado, que ignora acento, caixa, " +
    "pontuação e sufixo societário ('Acme', 'ACME Ltda.' e 'Acme S/A' são a mesma). " +
    "Use quando a pessoa mencionar uma empresa que search não encontrou.",
  input,
  async handler({ supabase, workspaceId, userId }, { name, domain: rawDomain }) {
    const domain = normalizeDomain(rawDomain)
    const usableDomain = domain && !isFreeMailDomain(domain) ? domain : null

    // 1. Domínio já ligado (020).
    if (usableDomain) {
      const { data: d } = await supabase
        .from("company_domains")
        .select("company_id")
        .eq("domain", usableDomain)
        .maybeSingle()
      if (d?.company_id) {
        const { data: c } = await supabase.from("companies").select("id, name").eq("id", d.company_id).maybeSingle()
        if (c) return { created: false, company_id: c.id, name: c.name, matched_by: "domain" }
      }
    }

    // 2. Nome normalizado. name_key é coluna gerada pela 020; antes dela, cai
    // na comparação antiga (só caixa e espaços).
    const key = companyNameKey(name)
    const byKey = key ? await supabase.from("companies").select("id, name").eq("name_key", key).limit(10) : null
    let match: { id: string; name: string } | undefined
    if (byKey && !byKey.error) {
      match = (byKey.data ?? []).find((c) => companyNameKey(c.name as string) === key) as typeof match
    } else {
      const legacy = companyDedupKey(name)
      const { data: candidates } = await supabase.from("companies").select("id, name").ilike("name", name).limit(50)
      match = (candidates ?? []).find((c) => companyDedupKey(c.name as string) === legacy) as typeof match
    }

    if (match) {
      if (usableDomain) await linkDomain(supabase, workspaceId, match.id, usableDomain)
      return { created: false, company_id: match.id, name: match.name, matched_by: "name" }
    }

    const { data: inserted, error } = await supabase
      .from("companies")
      .insert({ workspace_id: workspaceId, user_id: userId, name: name.trim(), domain: usableDomain })
      .select("id, name")
      .single()

    if (error) throw new Error(`Não consegui criar a empresa: ${error.message}`)

    if (usableDomain) await linkDomain(supabase, workspaceId, inserted.id, usableDomain)
    return { created: true, company_id: inserted.id, name: inserted.name }
  },
}

async function linkDomain(
  supabase: Parameters<(typeof findOrCreateCompany)["handler"]>[0]["supabase"],
  workspaceId: string,
  companyId: string,
  domain: string
) {
  // Domínio já de outra empresa: o índice recusa e fica como está. Mudar dono
  // de domínio é decisão da fila, não desta tool.
  await supabase.from("company_domains").insert({ workspace_id: workspaceId, domain, company_id: companyId, source: "mcp" })
}
