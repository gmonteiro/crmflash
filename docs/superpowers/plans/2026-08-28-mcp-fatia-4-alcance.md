# Servidor MCP do CRMFlash — Fatia 4 (alcance)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levar ao chat as três coisas do CRM que só existem no app — o dossiê de uma pessoa, as shortlists de trabalho, e os campos de empresa que só o enriquecimento preenchia.

**Architecture:** Cinco tools novas, no mesmo molde das quinze existentes. Nenhuma toca `src/lib/pipeline/` e nenhuma participa da fila do copiloto. Um módulo pequeno (`shortlists.ts`) guarda a validação de concordância de tipo, que é a única regra não trivial da fatia.

**Tech Stack:** o mesmo — zod 4, `@supabase/supabase-js`, vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-28-mcp-fatia-4-alcance.md`. Em conflito, a spec vence.
- **Nenhuma migration.** Todas as tabelas já existem.
- **Nenhuma tool apaga conteúdo.** `set_shortlist_membership(member: false)` remove um vínculo — um par de ids sem conteúdo próprio. Nenhuma outra tool desta fatia apaga nada.
- **`last_client_event_at` não é tocado** por nenhuma das cinco.
- **Nenhuma ganha `answers_question_key`** — nenhuma responde pendência do copiloto.
- **`name` não é editável** por `update_company`.
- `src/lib/pipeline/` não muda. Se aparecer no diff, algo saiu do lugar.
- Comentários e commits em português; código e identificadores em inglês.
- **Não rodar `prettier`.** O repo não tem config e os defaults dele acrescentam ponto e vírgula, que o repo não usa.
- Branch: `feat/mcp-alcance`, a partir de `master`. Contador de tools: 15 → 20.

## File Structure

**Criar**

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/mcp/shortlists.ts` | Concordância de tipo entre lista e entidade |
| `src/lib/mcp/tools/person-situation.ts` | Dossiê de uma pessoa |
| `src/lib/mcp/tools/update-company.ts` | Campos de firmografia |
| `src/lib/mcp/tools/list-shortlists.ts` | As listas, com contagem |
| `src/lib/mcp/tools/shortlist-members.ts` | Quem está numa lista |
| `src/lib/mcp/tools/set-shortlist-membership.ts` | Entra ou sai |

**Modificar**

| Arquivo | Mudança |
|---|---|
| `src/lib/mcp/registry.ts` | Registra as cinco |
| `src/lib/mcp/registry.test.ts` | 15 → 20 |
| `scripts/verify-oauth-flow.mjs` | 15 → 20 na checagem do `tools/list` |

---

## Task 1: Concordância de tipo nas shortlists

**Files:**
- Create: `src/lib/mcp/shortlists.ts`
- Test: `src/lib/mcp/shortlists.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type ShortlistEntityType = "person" | "company"`
  - `memberColumn(entityType: ShortlistEntityType): "person_id" | "company_id"`
  - `checkEntityMatches(entityType, exists: { person: boolean; company: boolean }): { ok: boolean; reason?: string }`

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/mcp/shortlists.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { memberColumn, checkEntityMatches } from "./shortlists"

describe("memberColumn", () => {
  it("mapeia o tipo da lista para a coluna do vínculo", () => {
    expect(memberColumn("person")).toBe("person_id")
    expect(memberColumn("company")).toBe("company_id")
  })
})

describe("checkEntityMatches", () => {
  it("aceita pessoa em lista de pessoa", () => {
    expect(checkEntityMatches("person", { person: true, company: false }).ok).toBe(true)
  })

  it("aceita empresa em lista de empresa", () => {
    expect(checkEntityMatches("company", { person: false, company: true }).ok).toBe(true)
  })

  it("recusa empresa em lista de pessoa", () => {
    const out = checkEntityMatches("person", { person: false, company: true })
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/lista de pessoas/)
  })

  it("recusa pessoa em lista de empresa", () => {
    const out = checkEntityMatches("company", { person: true, company: false })
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/lista de empresas/)
  })

  it("recusa id que não existe em lugar nenhum", () => {
    const out = checkEntityMatches("person", { person: false, company: false })
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/não existe/)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/mcp/shortlists.test.ts`
Expected: FAIL — `Failed to resolve import "./shortlists"`

- [ ] **Step 3: Implementar**

`src/lib/mcp/shortlists.ts`:

```ts
export type ShortlistEntityType = "person" | "company"

export function memberColumn(
  entityType: ShortlistEntityType
): "person_id" | "company_id" {
  return entityType === "person" ? "person_id" : "company_id"
}

/**
 * O banco não valida isto.
 *
 * O CHECK de shortlist_members garante que exatamente um entre person_id e
 * company_id está preenchido — mas não que o preenchido bate com o entity_type
 * da lista. Dá para pôr empresa numa lista de pessoas, e a UI não sabe
 * renderizar. Esta função é a validação que falta.
 */
export function checkEntityMatches(
  entityType: ShortlistEntityType,
  exists: { person: boolean; company: boolean }
): { ok: boolean; reason?: string } {
  if (!exists.person && !exists.company) {
    return { ok: false, reason: "esse id não existe como pessoa nem como empresa" }
  }

  if (entityType === "person" && !exists.person) {
    return { ok: false, reason: "é uma lista de pessoas, e esse id é de uma empresa" }
  }

  if (entityType === "company" && !exists.company) {
    return { ok: false, reason: "é uma lista de empresas, e esse id é de uma pessoa" }
  }

  return { ok: true }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/mcp/shortlists.test.ts`
Expected: PASS — 6 testes

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/shortlists.ts src/lib/mcp/shortlists.test.ts
git commit -m "feat(mcp): concordancia de tipo entre lista e entidade"
```

---

## Task 2: `person_situation`

**Files:**
- Create: `src/lib/mcp/tools/person-situation.ts`
- Test: `src/lib/mcp/tools/person-situation.test.ts`
- Modify: `src/lib/mcp/registry.ts`

**Interfaces:**
- Consumes: `McpTool` do registry.
- Produces: `personSituation` (`McpTool`).

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/mcp/tools/person-situation.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { z } from "zod"
import { personSituation } from "./person-situation"

const PE = "11111111-1111-4111-8111-111111111111"

describe("person_situation", () => {
  it("exige person_id em uuid", () => {
    expect(personSituation.input.safeParse({ person_id: "nao-e-uuid" }).success).toBe(false)
    expect(personSituation.input.safeParse({ person_id: PE }).success).toBe(true)
  })

  it("gera JSON Schema", () => {
    expect(z.toJSONSchema(personSituation.input)).toHaveProperty("type", "object")
  })

  it("a descrição diz que não há timeline — é o que evita o modelo insistir", () => {
    expect(personSituation.description.toLowerCase()).toContain("timeline")
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/mcp/tools/person-situation.test.ts`
Expected: FAIL — `Failed to resolve import "./person-situation"`

- [ ] **Step 3: Implementar**

`src/lib/mcp/tools/person-situation.ts`:

```ts
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
      .select(
        "id, full_name, first_name, last_name, email, phone, linkedin_url, " +
          "current_title, current_company, company_id, category, notes, linkedin_enriched_at"
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
```

- [ ] **Step 4: Registrar**

Em `src/lib/mcp/registry.ts`, importar `personSituation` e colocá-lo **logo depois de `companySituation`** — os dois são o mesmo gesto, um para cada entidade.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/mcp/tools/person-situation.test.ts`
Expected: PASS — 3 testes

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mcp/tools/person-situation.ts src/lib/mcp/tools/person-situation.test.ts src/lib/mcp/registry.ts
git commit -m "feat(mcp): dossie de pessoa"
```

---

## Task 3: `update_company`

**Files:**
- Create: `src/lib/mcp/tools/update-company.ts`
- Test: `src/lib/mcp/tools/update-company.test.ts`
- Modify: `src/lib/mcp/registry.ts`

**Interfaces:**
- Consumes: `fakeSupabase`.
- Produces: `updateCompany` (`McpTool`); `EDITABLE_FIELDS`.

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/mcp/tools/update-company.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { updateCompany, EDITABLE_FIELDS } from "./update-company"
import { fakeSupabase } from "@/lib/mcp/fake-supabase"
import type { McpIdentity } from "@/lib/mcp/identity"

const CO = "11111111-1111-4111-8111-111111111111"

function identity(client: unknown): McpIdentity {
  return { userId: "user-1", workspaceId: "ws-1", supabase: client as McpIdentity["supabase"] }
}

describe("EDITABLE_FIELDS", () => {
  it("não inclui name — renomear é decisão de app", () => {
    expect(EDITABLE_FIELDS).not.toContain("name")
  })

  it("cobre os campos que o enrich preenche", () => {
    for (const f of [
      "industry",
      "website",
      "domain",
      "size_tier",
      "employee_count",
      "estimated_revenue",
      "description",
      "linkedin_url",
    ]) {
      expect(EDITABLE_FIELDS).toContain(f)
    }
  })
})

describe("schema", () => {
  it("exige pelo menos um campo", () => {
    expect(updateCompany.input.safeParse({ company_id: CO }).success).toBe(false)
    expect(updateCompany.input.safeParse({ company_id: CO, industry: "Varejo" }).success).toBe(
      true
    )
  })

  it("não aceita name", () => {
    const parsed = updateCompany.input.safeParse({ company_id: CO, name: "Outro Nome" })
    expect(parsed.success).toBe(false)
  })

  it("employee_count precisa ser inteiro não negativo", () => {
    expect(updateCompany.input.safeParse({ company_id: CO, employee_count: -1 }).success).toBe(
      false
    )
    expect(updateCompany.input.safeParse({ company_id: CO, employee_count: 300 }).success).toBe(
      true
    )
  })
})

describe("handler", () => {
  it("devolve o valor anterior de cada campo — sobrescrita não pode ser silenciosa", async () => {
    const { client, calls } = fakeSupabase({
      companies: [{ id: CO, name: "Acme", industry: "Antigo", employee_count: 10 }],
    })

    const out = (await updateCompany.handler(identity(client), {
      company_id: CO,
      industry: "Varejo",
      website: undefined,
      domain: undefined,
      size_tier: undefined,
      employee_count: 300,
      estimated_revenue: undefined,
      description: undefined,
      linkedin_url: undefined,
    })) as { changed: { field: string; from: unknown; to: unknown }[] }

    expect(out.changed).toEqual([
      { field: "industry", from: "Antigo", to: "Varejo" },
      { field: "employee_count", from: 10, to: 300 },
    ])

    const update = calls.find((c) => c.table === "companies" && c.op === "update")
    expect(update!.payload).toEqual({ industry: "Varejo", employee_count: 300 })
  })

  it("não escreve last_client_event_at — descobrir dado não é o cliente agindo", async () => {
    const { client, calls } = fakeSupabase({ companies: [{ id: CO, name: "Acme" }] })

    await updateCompany.handler(identity(client), {
      company_id: CO,
      industry: "Varejo",
      website: undefined,
      domain: undefined,
      size_tier: undefined,
      employee_count: undefined,
      estimated_revenue: undefined,
      description: undefined,
      linkedin_url: undefined,
    })

    const update = calls.find((c) => c.table === "companies" && c.op === "update")
    expect(update!.payload).not.toHaveProperty("last_client_event_at")
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/mcp/tools/update-company.test.ts`
Expected: FAIL — `Failed to resolve import "./update-company"`

- [ ] **Step 3: Implementar**

`src/lib/mcp/tools/update-company.ts`:

```ts
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
      .select(["id", "name", ...EDITABLE_FIELDS].join(", "))
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
```

- [ ] **Step 4: Registrar**

Em `src/lib/mcp/registry.ts`, importar `updateCompany` e colocá-lo **logo depois de `setCompanyContext`** — são as duas tools que escrevem campo de empresa.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/mcp/tools/update-company.test.ts`
Expected: PASS — 6 testes

- [ ] **Step 6: Commit**

```bash
git add src/lib/mcp/tools/update-company.ts src/lib/mcp/tools/update-company.test.ts src/lib/mcp/registry.ts
git commit -m "feat(mcp): editar firmografia da empresa"
```

---

## Task 4: Ler as shortlists

**Files:**
- Create: `src/lib/mcp/tools/list-shortlists.ts`, `src/lib/mcp/tools/shortlist-members.ts`
- Test: `src/lib/mcp/tools/shortlist-read.test.ts`
- Modify: `src/lib/mcp/registry.ts`

**Interfaces:**
- Consumes: `ShortlistEntityType` da Task 1.
- Produces: `listShortlists`, `shortlistMembers`.

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/mcp/tools/shortlist-read.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { z } from "zod"
import { listShortlists } from "./list-shortlists"
import { shortlistMembers } from "./shortlist-members"

const SL = "11111111-1111-4111-8111-111111111111"

describe("list_shortlists", () => {
  it("roda sem argumento nenhum", () => {
    expect(listShortlists.input.safeParse({}).success).toBe(true)
  })

  it("gera JSON Schema", () => {
    expect(z.toJSONSchema(listShortlists.input)).toHaveProperty("type", "object")
  })
})

describe("shortlist_members", () => {
  it("exige shortlist_id em uuid", () => {
    expect(shortlistMembers.input.safeParse({ shortlist_id: "x" }).success).toBe(false)
    expect(shortlistMembers.input.safeParse({ shortlist_id: SL }).success).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/mcp/tools/shortlist-read.test.ts`
Expected: FAIL — módulos não resolvem

- [ ] **Step 3: Implementar `list_shortlists`**

`src/lib/mcp/tools/list-shortlists.ts`:

```ts
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
```

- [ ] **Step 4: Implementar `shortlist_members`**

`src/lib/mcp/tools/shortlist-members.ts`:

```ts
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
        "id, added_at, people(id, full_name, current_title, current_company), " +
          "companies(id, name, kanban_column_id)"
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
```

- [ ] **Step 5: Registrar as duas**

Em `src/lib/mcp/registry.ts`, importar `listShortlists` e `shortlistMembers` e colocá-los **depois de `search`** — as três são o bloco de "achar coisas".

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/mcp/tools/shortlist-read.test.ts`
Expected: PASS — 4 testes

- [ ] **Step 7: Commit**

```bash
git add src/lib/mcp/tools/list-shortlists.ts src/lib/mcp/tools/shortlist-members.ts \
        src/lib/mcp/tools/shortlist-read.test.ts src/lib/mcp/registry.ts
git commit -m "feat(mcp): ler as shortlists"
```

---

## Task 5: `set_shortlist_membership`

**Files:**
- Create: `src/lib/mcp/tools/set-shortlist-membership.ts`
- Test: `src/lib/mcp/tools/set-shortlist-membership.test.ts`
- Modify: `src/lib/mcp/registry.ts`, `src/lib/mcp/registry.test.ts`, `scripts/verify-oauth-flow.mjs`

**Interfaces:**
- Consumes: `memberColumn`, `checkEntityMatches` da Task 1.
- Produces: `setShortlistMembership`.

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/mcp/tools/set-shortlist-membership.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { setShortlistMembership } from "./set-shortlist-membership"

const ID = "11111111-1111-4111-8111-111111111111"

describe("schema", () => {
  it("exige os três campos", () => {
    expect(setShortlistMembership.input.safeParse({ shortlist_id: ID }).success).toBe(false)
    expect(
      setShortlistMembership.input.safeParse({
        shortlist_id: ID,
        entity_id: ID,
        member: true,
      }).success
    ).toBe(true)
  })

  it("member é booleano — entra ou sai, sem terceira opção", () => {
    expect(
      setShortlistMembership.input.safeParse({
        shortlist_id: ID,
        entity_id: ID,
        member: "sim",
      }).success
    ).toBe(false)
  })

  it("a descrição avisa que remover não apaga a pessoa", () => {
    expect(setShortlistMembership.description.toLowerCase()).toContain("não apaga")
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/mcp/tools/set-shortlist-membership.test.ts`
Expected: FAIL — módulo não resolve

- [ ] **Step 3: Implementar**

`src/lib/mcp/tools/set-shortlist-membership.ts`:

```ts
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
```

- [ ] **Step 4: Registrar e atualizar as contagens**

Em `src/lib/mcp/registry.ts`, importar `setShortlistMembership` e colocá-lo **logo depois de `shortlistMembers`**.

Em `src/lib/mcp/registry.test.ts`, o contador vira **20**.

Em `scripts/verify-oauth-flow.mjs`, a checagem do `tools/list` vira **20** (duas ocorrências: o label e a comparação).

- [ ] **Step 5: Rodar tudo**

Run: `npx vitest run`
Expected: PASS, com o teste de contagem em 20.

Run: `npx tsc --noEmit` e `npx eslint src/lib/mcp/`
Expected: limpos.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mcp scripts/verify-oauth-flow.mjs
git commit -m "feat(mcp): entrar e sair de shortlist"
```

---

## Task 6: Verificar contra o banco e publicar

**Files:** nenhum. Verificação e deploy.

- [ ] **Step 1: Subir e conferir a lista**

Com `npm run dev` (confira a porta no output; mate `next dev` órfãos antes se o log reclamar de lock):

```bash
TOKEN=$(grep '^MCP_DEV_TOKEN=' .env.local | cut -d= -f2)
curl -s -X POST localhost:3003/api/mcp -H 'content-type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const t=JSON.parse(d).result.tools;console.log(t.length+' tools');t.forEach(x=>console.log(' -',x.name))})"
```

Expected: **20 tools**, com `person_situation` após `company_situation`,
`list_shortlists` e `shortlist_members` após `search`, e `update_company` após
`set_company_context`.

- [ ] **Step 2: Ler as duas shortlists reais**

Chame `list_shortlists`.

Expected: "First" (245) e "CFO" (9), ambas `entity_type: person` — os 254 do
banco. Contagem diferente disso significa que o embed de count não resolveu, e
a tool estaria devolvendo zero em silêncio.

Depois `shortlist_members` numa delas: nomes, cargos e empresas reais, com
`truncated: false`.

- [ ] **Step 3: Ler uma pessoa real**

Pegue um `person_id` do passo anterior e chame `person_situation`.

Expected: cadastro preenchido, `shortlists` mostrando a lista de onde veio, e
`owners` com pelo menos um id.

- [ ] **Step 4: Recusa de tipo**

Chame `set_shortlist_membership` com o id de uma **empresa** numa das listas de
pessoa.

Expected: erro dizendo que é lista de pessoas e o id é de uma empresa. E nenhuma
linha nova em `shortlist_members`.

- [ ] **Step 5: Entrar, repetir, sair**

Com uma pessoa que **não** está na lista:

1. `member: true` → entra
2. `member: true` de novo → `already: true`, e a contagem não muda
3. `member: false` → sai

Confira a contagem no banco entre os passos:

```bash
node --env-file=.env.local -e "
const U=process.env.NEXT_PUBLIC_SUPABASE_URL,S=process.env.SUPABASE_SERVICE_ROLE_KEY;
const h={apikey:S,Authorization:'Bearer '+S,Prefer:'count=exact'};
fetch(U+'/rest/v1/shortlist_members?select=id&shortlist_id=eq.<ID>',{headers:h})
  .then(r=>console.log('membros:', r.headers.get('content-range')));
"
```

Expected: sobe um, fica igual, volta ao original.

- [ ] **Step 6: Atualizar uma empresa**

Escolha uma empresa e chame `update_company` mudando um campo.

Expected: o retorno traz `changed` com `from` e `to`. **Anote o `from`** — se
for um valor real e não `null`, restaure-o depois com uma segunda chamada.

- [ ] **Step 7: Suíte e verificadores**

```bash
npm test
npm run verify:mcp
npm run verify:oauth -- http://localhost:3003
```

Expected: os três verdes.

- [ ] **Step 8: Deploy**

```bash
npx vercel --prod
npm run verify:oauth -- https://crmflash.vercel.app
git push origin master
```

Expected: `Fluxo OAuth conforme.` e `tools/list` de produção com 20.

- [ ] **Step 9: Reconectar o conector**

O claude.ai guarda a lista de tools da conexão. Depois do deploy, o conector
CRMFlash pode continuar mostrando 15 até ser recarregado — desconectar e
conectar de novo resolve, e o cliente já está registrado, então vai direto para
o consentimento.

---

## Estado ao fim da Fatia 4

- Pessoa deixa de ser só um nome numa busca.
- As duas listas de trabalho passam a ser legíveis e editáveis pelo chat.
- Os campos que só o enriquecimento preenchia ganham uma tool, e sobrescrever
  deixa de ser invisível: o valor anterior volta no retorno.
- 20 tools. A invariante de não apagar conteúdo continua de pé — o único delete
  da fatia desfaz um vínculo que readicionar restaura idêntico.
