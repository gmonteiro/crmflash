import { z } from "zod"
import type { McpTool } from "../registry"

/**
 * Os campos que o enriquecimento preenchia e nenhuma tool alcançava.
 *
 * `name` está fora de propósito: ele é identidade da empresa e alimenta o
 * companyDedupKey do find_or_create. Renomear é decisão de app.
 */
export const EDITABLE_FIELDS = [
  "industry",
  "website",
  "domain",
  "size_tier",
  "employee_count",
  "estimated_revenue",
  "description",
  "linkedin_url",
] as const

const input = z
  .object({
    company_id: z.string().uuid(),
    industry: z.string().optional().describe("Setor, como o mercado chama."),
    website: z.string().optional(),
    domain: z.string().optional().describe("Só o domínio, sem protocolo."),
    size_tier: z.string().optional().describe("Faixa de porte usada no CRM."),
    employee_count: z.number().int().min(0).optional(),
    estimated_revenue: z.number().min(0).optional().describe("Faturamento anual estimado."),
    description: z.string().optional(),
    linkedin_url: z.string().optional(),
  })
  .strict()
  .refine((v) => EDITABLE_FIELDS.some((f) => v[f] !== undefined), {
    message: "Informe pelo menos um campo para atualizar.",
  })

export const updateCompany: McpTool<typeof input> = {
  name: "update_company",
  description:
    "Atualiza os dados de firmografia de uma empresa: setor, site, domínio, porte, " +
    "número de funcionários, faturamento estimado, descrição e LinkedIn. Use quando " +
    "descobrir esses dados pesquisando — SOBRESCREVE o que já estiver lá, então " +
    "confirme com a pessoa antes se o campo já tem valor. Não muda o nome da empresa " +
    "e não conta como evento do cliente.",
  input,
  async handler({ supabase, workspaceId }, args) {
    const { data: before } = await supabase
      .from("companies")
      .select(
        "id, name, industry, website, domain, size_tier, employee_count, estimated_revenue, description, linkedin_url"
      )
      .eq("id", args.company_id)
      .maybeSingle()

    if (!before) throw new Error(`Empresa ${args.company_id} não encontrada.`)

    const patch: Record<string, unknown> = {}
    const changed: { field: string; from: unknown; to: unknown }[] = []

    for (const field of EDITABLE_FIELDS) {
      const value = args[field]
      if (value === undefined) continue

      patch[field] = value
      // O valor anterior vai no retorno: sobrescrever dado bom é o risco desta
      // tool, e o mínimo é a sobrescrita não ser silenciosa.
      changed.push({
        field,
        from: (before as Record<string, unknown>)[field] ?? null,
        to: value,
      })
    }

    const { error } = await supabase
      .from("companies")
      .update(patch)
      .eq("id", args.company_id)
      .eq("workspace_id", workspaceId)

    if (error) throw new Error(`Não consegui atualizar: ${error.message}`)

    return { company: (before as { name: string }).name, changed }
  },
}
