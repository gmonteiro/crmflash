# Servidor MCP do CRMFlash — Fatia 3 (fechar o laço do copiloto)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar impossível suprimir uma pendência do copiloto sem ter escrito algo, e tornar executáveis as ações prontas que a fila já mostra.

**Architecture:** Nada novo em `src/lib/pipeline/`. Um módulo pequeno (`suppress.ts`) que valida a `question_key` e grava o evento; uma tool nova que executa as quick actions do app; um parâmetro opcional em três tools de escrita; e uma renomeação que torna o mau uso inexprimível.

**Tech Stack:** o mesmo — zod 4, `@supabase/supabase-js`, vitest, e as derivações que já existem em `src/lib/pipeline/`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-27-mcp-fatia-3-laco-copiloto.md`. Em conflito, a spec vence.
- **Nenhuma tool apaga.** A ação `"Não faz mais sentido"` (`delete_next_step`) é recusada com recado para o app.
- **`last_client_event_at` só sobe quando o cliente agiu.** As quick actions do app já respeitam isso; executá-las não pode alterar esse comportamento.
- **`applyEffect`, `recordCopilotEvent`, `detectQuestions` e `rules.ts` não mudam.** Se algum aparecer no diff com mudança de lógica, algo saiu do lugar.
- **A migration 016 já rodou.** Nenhuma migration nova nesta fatia.
- Comentários e commits em português; código e identificadores em inglês.
- Testes: `npx vitest run <arquivo>`. Branch: `feat/mcp-laco`, a criar a partir de `master`.
- O contador de tools sobe de 14 para 15 — `registry.test.ts` precisa acompanhar.

## File Structure

**Criar**

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/mcp/suppress.ts` | Separar e validar `question_key`; gravar a supressão |
| `src/lib/mcp/tools/answer-with-action.ts` | Executar a quick action do app |

**Modificar**

| Arquivo | Mudança |
|---|---|
| `src/lib/mcp/tools/log-activity.ts` | `+ answers_question_key` |
| `src/lib/mcp/tools/set-next-step.ts` | `+ answers_question_key` |
| `src/lib/mcp/tools/capture-signal.ts` | `+ answers_question_key` |
| `src/lib/mcp/tools/set-company-context.ts` | `+ answers_question_key` |
| `src/lib/mcp/tools/answer-copilot-question.ts` | Vira `snooze-copilot-question.ts`; perde `answered` |
| `src/lib/mcp/tools/whats-stuck.ts` | Filtra ação de rascunho; devolve `suppress_days` |
| `src/lib/mcp/registry.ts` | Registra a nova, renomeia a antiga |
| `src/lib/mcp/registry.test.ts` | 14 → 15 |

---

## Task 1: Validar a chave e gravar a supressão

**Files:**
- Create: `src/lib/mcp/suppress.ts`
- Test: `src/lib/mcp/suppress.test.ts`

**Interfaces:**
- Consumes: `recordCopilotEvent` de `@/lib/pipeline/copilot-events`; `NARRATION_SUPPRESS_DAYS` de `@/lib/constants`; `fakeSupabase` de `./fake-supabase`.
- Produces:
  - `parseQuestionKey(key: string): { ruleId: CopilotRuleId; companyId: string } | null`
  - `suppressFromWrite(supabase, params): Promise<{ suppressed: boolean; reason?: string }>`

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/mcp/suppress.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { parseQuestionKey, suppressFromWrite } from "./suppress"
import { fakeSupabase } from "./fake-supabase"

const CO = "11111111-1111-4111-8111-111111111111"

describe("parseQuestionKey", () => {
  it("separa regra e empresa de uma chave de dois campos", () => {
    expect(parseQuestionKey(`no_next_step:${CO}`)).toEqual({
      ruleId: "no_next_step",
      companyId: CO,
    })
  })

  it("ignora o terceiro campo, que é a entidade", () => {
    expect(parseQuestionKey(`next_step_overdue:${CO}:algum-step-id`)).toEqual({
      ruleId: "next_step_overdue",
      companyId: CO,
    })
  })

  it("recusa regra que não existe", () => {
    expect(parseQuestionKey(`regra_inventada:${CO}`)).toBeNull()
  })

  it("recusa chave malformada", () => {
    expect(parseQuestionKey("sem_dois_pontos")).toBeNull()
    expect(parseQuestionKey("")).toBeNull()
  })
})

describe("suppressFromWrite", () => {
  const base = { workspaceId: "ws-1", userId: "user-1", companyId: CO }

  it("grava o evento com os dias da regra", async () => {
    const { client, calls } = fakeSupabase()

    const out = await suppressFromWrite(client, {
      ...base,
      questionKey: `missing_pain_hypothesis:${CO}`,
      applied: { tool: "set_company_context", updated: ["pain_hypothesis"] },
    })

    expect(out.suppressed).toBe(true)
    const insert = calls.find((c) => c.table === "copilot_question_events")
    expect(insert!.payload).toMatchObject({
      question_key: `missing_pain_hypothesis:${CO}`,
      rule_id: "missing_pain_hypothesis",
      status: "answered",
    })
  })

  it("preenche o applied, que é o registro do que foi feito", async () => {
    const { client, calls } = fakeSupabase()

    await suppressFromWrite(client, {
      ...base,
      questionKey: `no_next_step:${CO}`,
      applied: { tool: "set_next_step", title: "Mandar proposta" },
    })

    const insert = calls.find((c) => c.table === "copilot_question_events")
    expect(insert!.payload).toHaveProperty("applied")
    expect((insert!.payload as { applied: unknown }).applied).toMatchObject({
      tool: "set_next_step",
    })
  })

  it("recusa chave de outra empresa sem gravar nada", async () => {
    const { client, calls } = fakeSupabase()

    const out = await suppressFromWrite(client, {
      ...base,
      questionKey: "no_next_step:22222222-2222-4222-8222-222222222222",
      applied: {},
    })

    expect(out.suppressed).toBe(false)
    expect(out.reason).toMatch(/outra empresa/)
    expect(calls).toHaveLength(0)
  })

  it("recusa chave inválida sem gravar nada", async () => {
    const { client, calls } = fakeSupabase()

    const out = await suppressFromWrite(client, {
      ...base,
      questionKey: "lixo",
      applied: {},
    })

    expect(out.suppressed).toBe(false)
    expect(calls).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/mcp/suppress.test.ts`
Expected: FAIL — `Failed to resolve import "./suppress"`

- [ ] **Step 3: Implementar**

`src/lib/mcp/suppress.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js"
import { NARRATION_SUPPRESS_DAYS } from "@/lib/constants"
import { recordCopilotEvent } from "@/lib/pipeline/copilot-events"
import type { CopilotRuleId } from "@/types/copilot"

const RULE_IDS: readonly CopilotRuleId[] = [
  "meeting_yesterday",
  "next_step_overdue",
  "no_next_step",
  "frozen_candidate",
  "stalled_card",
  "no_signal_past_stage",
  "exit_criteria_unmet",
  "missing_champion",
  "missing_pain_hypothesis",
]

/**
 * A chave é `rule_id:company_id[:entity_id]` — determinística, montada em
 * rules.ts. Regra e empresa saem dela, então nenhuma tool precisa de parâmetro
 * extra para suprimir.
 */
export function parseQuestionKey(
  key: string
): { ruleId: CopilotRuleId; companyId: string } | null {
  const [ruleId, companyId] = (key ?? "").split(":")
  if (!ruleId || !companyId) return null
  if (!RULE_IDS.includes(ruleId as CopilotRuleId)) return null

  return { ruleId: ruleId as CopilotRuleId, companyId }
}

export interface SuppressFromWriteParams {
  workspaceId: string
  userId: string | null
  /** A empresa em que a tool ACABOU de escrever. */
  companyId: string
  questionKey: string
  /** O que foi feito. Vai para a coluna applied, que existe para isto. */
  applied: Record<string, unknown>
}

/**
 * Suprime a pendência porque uma escrita aconteceu.
 *
 * É chamada DEPOIS da escrita, de dentro da própria tool — é isso que torna a
 * supressão efeito colateral do trabalho, em vez de uma segunda chamada que o
 * modelo pode esquecer ou fazer sozinha.
 *
 * Chave inválida não desfaz a escrita: devolve o motivo e a pergunta continua
 * na fila. Errar para o lado de perguntar de novo é barato; errar para o lado
 * de esconder a conta não é.
 */
export async function suppressFromWrite(
  supabase: SupabaseClient,
  params: SuppressFromWriteParams
): Promise<{ suppressed: boolean; reason?: string }> {
  const parsed = parseQuestionKey(params.questionKey)
  if (!parsed) {
    return { suppressed: false, reason: "question_key inválida — a escrita foi feita" }
  }

  if (parsed.companyId !== params.companyId) {
    return {
      suppressed: false,
      reason: "a question_key é de outra empresa — a escrita foi feita",
    }
  }

  await recordCopilotEvent(supabase, {
    workspaceId: params.workspaceId,
    userId: params.userId,
    companyId: params.companyId,
    questionKey: params.questionKey,
    ruleId: parsed.ruleId,
    status: "answered",
    suppressDays: NARRATION_SUPPRESS_DAYS[parsed.ruleId] ?? 3,
    applied: params.applied,
  })

  return { suppressed: true }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/mcp/suppress.test.ts`
Expected: PASS — 8 testes

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/suppress.ts src/lib/mcp/suppress.test.ts
git commit -m "feat(mcp): supressao a partir da escrita"
```

---

## Task 2: `answers_question_key` nas tools de escrita

**Files:**
- Modify: `src/lib/mcp/tools/log-activity.ts`, `set-next-step.ts`, `capture-signal.ts`, `set-company-context.ts`
- Test: `src/lib/mcp/tools/answers-question.test.ts`

**Interfaces:**
- Consumes: `suppressFromWrite` da Task 1.
- Produces: as quatro tools passam a aceitar `answers_question_key` e a devolver `suppressed` na resposta.

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/mcp/tools/answers-question.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { logActivity } from "./log-activity"
import { setCompanyContext } from "./set-company-context"
import { fakeSupabase } from "@/lib/mcp/fake-supabase"
import type { McpIdentity } from "@/lib/mcp/identity"

const CO = "11111111-1111-4111-8111-111111111111"

function identity(client: unknown): McpIdentity {
  return { userId: "user-1", workspaceId: "ws-1", supabase: client as McpIdentity["supabase"] }
}

describe("answers_question_key em log_activity", () => {
  it("é opcional — a tool continua servindo sem pendência nenhuma", async () => {
    const { client, calls } = fakeSupabase({ company_activities: [] })

    const out = (await logActivity.handler(identity(client), {
      company_id: CO,
      type: "note",
      title: "Nota solta",
      description: null,
      client_engaged: false,
      answers_question_key: null,
    })) as { suppressed?: boolean }

    expect(out.suppressed).toBeUndefined()
    expect(calls.some((c) => c.table === "copilot_question_events")).toBe(false)
  })

  it("com a chave, escreve E suprime na mesma chamada", async () => {
    const { client, calls } = fakeSupabase({ company_activities: [] })

    const out = (await logActivity.handler(identity(client), {
      company_id: CO,
      type: "meeting",
      title: "Reunião de diagnóstico",
      description: null,
      client_engaged: true,
      answers_question_key: `meeting_yesterday:${CO}:alguma-atividade`,
    })) as { suppressed?: boolean }

    expect(out.suppressed).toBe(true)
    expect(calls.some((c) => c.table === "company_activities" && c.op === "insert")).toBe(true)
    expect(calls.some((c) => c.table === "copilot_question_events")).toBe(true)
  })

  it("chave de outra empresa: a escrita fica, a supressão não", async () => {
    const { client, calls } = fakeSupabase({ company_activities: [] })

    const out = (await logActivity.handler(identity(client), {
      company_id: CO,
      type: "note",
      title: "Nota",
      description: null,
      client_engaged: false,
      answers_question_key: "no_next_step:22222222-2222-4222-8222-222222222222",
    })) as { suppressed?: boolean; suppress_error?: string }

    expect(out.suppressed).toBe(false)
    expect(out.suppress_error).toMatch(/outra empresa/)
    expect(calls.some((c) => c.table === "company_activities" && c.op === "insert")).toBe(true)
    expect(calls.some((c) => c.table === "copilot_question_events")).toBe(false)
  })

  it("duplicata não suprime: nada foi escrito", async () => {
    const existing = { id: "act-1", type: "note", title: "Nota" }
    const { client, calls } = fakeSupabase({ company_activities: [existing] })

    const out = (await logActivity.handler(identity(client), {
      company_id: CO,
      type: "note",
      title: "Nota",
      description: null,
      client_engaged: false,
      answers_question_key: `no_next_step:${CO}`,
    })) as { deduplicated: boolean; suppressed?: boolean }

    expect(out.deduplicated).toBe(true)
    expect(calls.some((c) => c.table === "copilot_question_events")).toBe(false)
  })
})

describe("answers_question_key em set_company_context", () => {
  it("suprime quando escreveu algum campo", async () => {
    const { client, calls } = fakeSupabase()

    const out = (await setCompanyContext.handler(identity(client), {
      company_id: CO,
      champion_name: "Ana",
      economic_buyer_name: undefined,
      pain_hypothesis: undefined,
      answers_question_key: `missing_champion:${CO}`,
    })) as { suppressed?: boolean }

    expect(out.suppressed).toBe(true)
    expect(calls.some((c) => c.table === "copilot_question_events")).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/mcp/tools/answers-question.test.ts`
Expected: FAIL — o schema recusa `answers_question_key`, que ainda não existe

- [ ] **Step 3: Acrescentar o campo ao schema das quatro tools**

Em cada uma das quatro, acrescente ao objeto `z.object({...})`:

```ts
  answers_question_key: z
    .string()
    .nullable()
    .default(null)
    .describe(
      "Se esta escrita responde uma pendência de whats_stuck, copie aqui o " +
        "question_key dela. A pergunta sai da fila na mesma chamada — não " +
        "existe outra forma de marcá-la como tratada."
    ),
```

Em `set-company-context.ts` o schema termina com `.refine(...)`; o campo entra no `z.object` **antes** do refine.

- [ ] **Step 4: Suprimir depois da escrita, em `log_activity`**

Em `src/lib/mcp/tools/log-activity.ts`, o `return` final vira:

```ts
    const applied = {
      tool: "log_activity",
      activity_id: inserted?.id ?? null,
      type: args.type,
      client_engaged: args.client_engaged,
    }

    const suppression = args.answers_question_key
      ? await suppressFromWrite(supabase, {
          workspaceId,
          userId,
          companyId: args.company_id,
          questionKey: args.answers_question_key,
          applied,
        })
      : null

    return {
      deduplicated: false,
      activity_id: inserted?.id ?? null,
      client_event_marked: args.client_engaged,
      ...(suppression
        ? { suppressed: suppression.suppressed, suppress_error: suppression.reason }
        : {}),
    }
```

E o `import { suppressFromWrite } from "../suppress"` no topo.

**O retorno da duplicata não muda.** Ele sai antes deste bloco, então uma chamada repetida não suprime — que é o certo: nada foi escrito.

- [ ] **Step 5: Repetir nas outras três**

Mesma forma, com o `applied` de cada uma:

`set-next-step.ts`, depois do `applyEffect`:

```ts
    const applied = { tool: "set_next_step", title: args.title, due_date: args.due_date ?? null }
```

`capture-signal.ts`, depois do `applyEffect`:

```ts
    const applied = { tool: "capture_signal", signal: args.signal }
```

`set-company-context.ts`, depois do laço, usando o que foi escrito:

```ts
    const applied = { tool: "set_company_context", updated: written }
```

Em `set-company-context.ts` a supressão só acontece se `written.length > 0` — se nenhum campo foi passado o refine já barrou, mas a guarda deixa a regra explícita.

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/mcp/tools/`
Expected: PASS, incluindo os testes antigos das quatro tools — o campo é opcional e não muda o comportamento sem ele.

- [ ] **Step 7: Commit**

```bash
git add src/lib/mcp/tools/log-activity.ts src/lib/mcp/tools/set-next-step.ts \
        src/lib/mcp/tools/capture-signal.ts src/lib/mcp/tools/set-company-context.ts \
        src/lib/mcp/tools/answers-question.test.ts
git commit -m "feat(mcp): escrever passa a poder responder a pendencia"
```

---

## Task 3: `answer_with_action` — executar a ação do app

**Files:**
- Create: `src/lib/mcp/tools/answer-with-action.ts`
- Test: `src/lib/mcp/tools/answer-with-action.test.ts`
- Modify: `src/lib/mcp/registry.ts`, `src/lib/mcp/registry.test.ts`

**Interfaces:**
- Consumes: `fetchPipelineSnapshot`, `detectQuestions`, `applyEffect`, `recordCopilotEvent`.
- Produces: `answerWithAction` (`McpTool`); `isDestructive(action: CopilotQuickAction): boolean`.

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/mcp/tools/answer-with-action.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { z } from "zod"
import { answerWithAction, isDestructive } from "./answer-with-action"
import type { CopilotQuickAction } from "@/types/copilot"

const CO = "11111111-1111-4111-8111-111111111111"

function action(over: Partial<CopilotQuickAction> = {}): CopilotQuickAction {
  return {
    id: "advanced",
    label: "Avançou de estágio",
    suppressDays: 7,
    effects: [{ kind: "move_stage", target: "next" }],
    ...over,
  }
}

describe("isDestructive", () => {
  it("marca a ação que apaga próximo passo", () => {
    expect(
      isDestructive(action({ effects: [{ kind: "delete_next_step", stepId: "s-1" }] }))
    ).toBe(true)
  })

  it("não marca as demais", () => {
    expect(isDestructive(action())).toBe(false)
    expect(
      isDestructive(action({ effects: [{ kind: "complete_next_step", stepId: "s-1" }] }))
    ).toBe(false)
  })
})

describe("schema", () => {
  it("exige question_key e action_id", () => {
    expect(answerWithAction.input.safeParse({ question_key: `no_next_step:${CO}` }).success).toBe(
      false
    )
    expect(
      answerWithAction.input.safeParse({
        question_key: `no_next_step:${CO}`,
        action_id: "tomorrow",
      }).success
    ).toBe(true)
  })

  it("gera JSON Schema", () => {
    expect(z.toJSONSchema(answerWithAction.input)).toHaveProperty("type", "object")
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/mcp/tools/answer-with-action.test.ts`
Expected: FAIL — `Failed to resolve import "./answer-with-action"`

- [ ] **Step 3: Implementar**

`src/lib/mcp/tools/answer-with-action.ts`:

```ts
import { z } from "zod"
import { fetchPipelineSnapshot } from "@/lib/pipeline/snapshot"
import { detectQuestions } from "@/lib/pipeline/rules"
import { applyEffect } from "@/lib/pipeline/effects"
import { recordCopilotEvent } from "@/lib/pipeline/copilot-events"
import type { CopilotQuickAction } from "@/types/copilot"
import type { McpTool } from "../registry"

/**
 * Uma única ação da fila apaga: "Não faz mais sentido", na regra
 * next_step_overdue. A invariante do MCP é que nenhuma tool apaga — erro do
 * modelo se desfaz no app, o contrário não. Então esta ação é recusada.
 */
export function isDestructive(action: CopilotQuickAction): boolean {
  return action.effects.some((e) => e.kind === "delete_next_step")
}

const input = z.object({
  question_key: z
    .string()
    .min(1)
    .describe("Copie exatamente o question_key devolvido por whats_stuck."),
  action_id: z
    .string()
    .min(1)
    .describe("O id de uma das suggested_answers daquela pendência."),
})

export const answerWithAction: McpTool<typeof input> = {
  name: "answer_with_action",
  description:
    "Responde uma pendência de whats_stuck escolhendo uma das respostas prontas " +
    "que ela oferece. Aplica exatamente o que o app aplicaria naquele botão e tira " +
    "a pergunta da fila, numa chamada só. PREFIRA esta tool quando alguma das " +
    "suggested_answers descreve o que aconteceu — só caia nas tools de escrita " +
    "quando nenhuma servir.",
  input,
  async handler({ supabase, workspaceId, userId }, args) {
    const snap = await fetchPipelineSnapshot(supabase, {
      includeActivities: true,
      includePeople: true,
    })

    const today = new Date().toISOString().slice(0, 10)
    const { data: events } = await supabase
      .from("copilot_question_events")
      .select("question_key")
      .gte("suppress_until", today)

    const suppressed = new Set((events ?? []).map((e) => e.question_key as string))

    // Tetos generosos de propósito. Os padrões (6 contas, 4 por conta) existem
    // para o card não virar parede; aqui eles causariam recusa falsa — uma
    // pendência real que o modelo acabou de ver ficaria fora do corte se o
    // pipeline mexeu, e a tool diria "não existe mais" mentindo.
    const question = detectQuestions(snap, suppressed, {
      limit: 500,
      maxPerCompany: 50,
    }).find((q) => q.key === args.question_key)

    // Recalcular é obrigatório: os efeitos vêm amarrados a ids concretos
    // (stepId), e entre o whats_stuck e esta chamada a outra pessoa do
    // workspace pode ter mexido no card. Aplicar efeito de uma pergunta que
    // não existe mais seria escrever no passado.
    if (!question) {
      throw new Error(
        "Essa pendência não está mais na fila. Pode ter sido tratada por outra " +
          "pessoa, ou a empresa mudou de estágio. Chame whats_stuck de novo."
      )
    }

    const action = question.actions.find((a) => a.id === args.action_id)
    if (!action) {
      const opcoes = question.actions.map((a) => a.id).join(", ")
      throw new Error(`Ação "${args.action_id}" não existe nessa pendência. Opções: ${opcoes}`)
    }

    if (isDestructive(action)) {
      throw new Error(
        `A opção "${action.label}" apaga o próximo passo, e nenhuma tool do MCP ` +
          "apaga. Faça isso no app, ou escolha outra opção."
      )
    }

    for (const effect of action.effects) {
      await applyEffect(
        supabase,
        { workspaceId, userId, companyId: question.companyId, snapshot: snap },
        effect
      )
    }

    await recordCopilotEvent(supabase, {
      workspaceId,
      userId,
      companyId: question.companyId,
      questionKey: question.key,
      ruleId: question.ruleId,
      status: "answered",
      suppressDays: action.suppressDays,
      actionId: action.id,
      applied: { action: action.id, label: action.label, effects: action.effects },
    })

    return {
      company: question.companyName,
      answered: question.title,
      action: action.label,
      hidden_for_days: action.suppressDays,
    }
  },
}
```

- [ ] **Step 4: Registrar**

Em `src/lib/mcp/registry.ts`, importar `answerWithAction` e colocá-lo **logo depois de `whatsStuck`** — é a resposta natural do que aquela tool devolve, e a ordem do `tools/list` importa para o modelo.

Em `src/lib/mcp/registry.test.ts`, o contador vira 15.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/mcp/`
Expected: PASS, com o teste de contagem em 15.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mcp/tools/answer-with-action.ts \
        src/lib/mcp/tools/answer-with-action.test.ts \
        src/lib/mcp/registry.ts src/lib/mcp/registry.test.ts
git commit -m "feat(mcp): executar as respostas prontas da fila"
```

---

## Task 4: `answer_copilot_question` vira `snooze_copilot_question`

**Files:**
- Create: `src/lib/mcp/tools/snooze-copilot-question.ts`
- Delete: `src/lib/mcp/tools/answer-copilot-question.ts`
- Modify: `src/lib/mcp/tools/answer-copilot.test.ts` → `snooze-copilot.test.ts`, `src/lib/mcp/registry.ts`

**Interfaces:**
- Consumes: `recordCopilotEvent`.
- Produces: `snoozeCopilotQuestion` (`McpTool`), sem o status `answered`.

- [ ] **Step 1: Reescrever o teste**

`src/lib/mcp/tools/snooze-copilot.test.ts` (renomeie o arquivo antigo com `git mv` e substitua o conteúdo):

```ts
import { describe, it, expect } from "vitest"
import { snoozeCopilotQuestion } from "./snooze-copilot-question"
import { fakeSupabase } from "@/lib/mcp/fake-supabase"
import type { McpIdentity } from "@/lib/mcp/identity"

const CO = "11111111-1111-4111-8111-111111111111"

function identity(client: unknown): McpIdentity {
  return { userId: "user-1", workspaceId: "ws-1", supabase: client as McpIdentity["supabase"] }
}

describe("snooze_copilot_question", () => {
  it("adia sem escrever mais nada", async () => {
    const { client, calls } = fakeSupabase()

    await snoozeCopilotQuestion.handler(identity(client), {
      company_id: CO,
      question_key: `no_next_step:${CO}`,
      rule_id: "no_next_step",
      status: "snoozed",
      suppress_days: 3,
      reason: "Cliente em férias até semana que vem",
    })

    const written = calls.filter((c) => c.op === "insert")
    expect(written).toHaveLength(1)
    expect(written[0].table).toBe("copilot_question_events")
    expect(written[0].payload).toMatchObject({ status: "snoozed" })
  })

  it("NÃO aceita answered — tratar exige escrever", () => {
    const parsed = snoozeCopilotQuestion.input.safeParse({
      company_id: CO,
      question_key: `no_next_step:${CO}`,
      rule_id: "no_next_step",
      status: "answered",
      suppress_days: 3,
    })
    expect(parsed.success).toBe(false)
  })

  it("aceita dismissed", () => {
    expect(
      snoozeCopilotQuestion.input.safeParse({
        company_id: CO,
        question_key: `no_next_step:${CO}`,
        rule_id: "no_next_step",
        status: "dismissed",
        suppress_days: 365,
      }).success
    ).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/mcp/tools/snooze-copilot.test.ts`
Expected: FAIL — módulo não resolve

- [ ] **Step 3: Implementar**

`src/lib/mcp/tools/snooze-copilot-question.ts`:

```ts
import { z } from "zod"
import { recordCopilotEvent } from "@/lib/pipeline/copilot-events"
import type { McpTool } from "../registry"

const input = z.object({
  company_id: z.string().uuid(),
  question_key: z
    .string()
    .min(1)
    .describe("Copie exatamente o question_key devolvido por whats_stuck."),
  rule_id: z.enum([
    "meeting_yesterday",
    "next_step_overdue",
    "no_next_step",
    "frozen_candidate",
    "stalled_card",
    "no_signal_past_stage",
    "exit_criteria_unmet",
    "missing_champion",
    "missing_pain_hypothesis",
  ]),
  status: z
    .enum(["snoozed", "dismissed"])
    .describe("snoozed = adiar; dismissed = essa pergunta não se aplica a esta conta."),
  suppress_days: z
    .number()
    .int()
    .min(1)
    .max(365)
    .describe("Dias até a pergunta voltar. Use 365 para dismissed."),
  reason: z
    .string()
    .nullable()
    .default(null)
    .describe("Por que está sendo adiada ou descartada."),
})
```

O que mudou em relação ao arquivo antigo: o `status` perdeu `answered`, o campo
`answer_text` virou `reason`, e a descrição diz para que a tool serve agora.

```ts
export const snoozeCopilotQuestion: McpTool<typeof input> = {
  name: "snooze_copilot_question",
  description:
    "Adia uma pendência de whats_stuck, ou marca que ela não se aplica. Use SOMENTE " +
    "quando não há nada a registrar — cliente de férias, pergunta sem sentido para " +
    "essa conta. Para dizer que a pendência foi TRATADA, use answer_with_action ou " +
    "passe o question_key na tool de escrita: uma pendência não pode sair da fila " +
    "como resolvida sem que algo tenha sido escrito.",
  input,
  async handler({ supabase, workspaceId, userId }, args) {
    await recordCopilotEvent(supabase, {
      workspaceId,
      userId,
      companyId: args.company_id,
      questionKey: args.question_key,
      ruleId: args.rule_id,
      status: args.status,
      suppressDays: args.suppress_days,
      answerText: args.reason,
    })

    return { question_key: args.question_key, status: args.status, hidden_for_days: args.suppress_days }
  },
}
```

- [ ] **Step 4: Trocar no registry**

Em `src/lib/mcp/registry.ts`, substituir o import e a entrada de `answerCopilotQuestion` por `snoozeCopilotQuestion`. A contagem continua 15.

- [ ] **Step 5: Apagar o arquivo antigo**

```bash
git rm src/lib/mcp/tools/answer-copilot-question.ts
```

- [ ] **Step 6: Rodar tudo**

Run: `npx vitest run`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: sem erros. Se sobrar referência a `answerCopilotQuestion`, é o registry.

- [ ] **Step 7: Commit**

```bash
git add -A src/lib/mcp
git commit -m "refactor(mcp): answer_copilot_question vira snooze_copilot_question

Perde o status answered. A tool que suprime sem fazer nada passa a se
chamar pelo que ela e, e tratar sem escrever deixa de ser exprimivel."
```

---

## Task 5: Ajustar `whats_stuck`

**Files:**
- Modify: `src/lib/mcp/tools/whats-stuck.ts`
- Test: `src/lib/mcp/tools/whats-stuck.test.ts`

**Interfaces:**
- Consumes: `isDestructive` da Task 3.
- Produces: `suggested_answers` sem ações de rascunho, com `suppress_days` e marca do que é destrutivo.

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/mcp/tools/whats-stuck.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { offerableActions } from "./whats-stuck"
import type { CopilotQuickAction } from "@/types/copilot"

const ACTIONS: CopilotQuickAction[] = [
  { id: "done", label: "Concluído", suppressDays: 7, effects: [{ kind: "complete_next_step", stepId: "s-1" }] },
  { id: "drop", label: "Não faz mais sentido", suppressDays: 30, effects: [{ kind: "delete_next_step", stepId: "s-1" }] },
  { id: "draft", label: "Redigir retomada", suppressDays: 0, effects: [{ kind: "open_drafts", draftKind: "retomada" }] },
]

describe("offerableActions", () => {
  it("esconde a ação de rascunho — ela não escreve nada", () => {
    expect(offerableActions(ACTIONS).map((a) => a.id)).not.toContain("draft")
  })

  it("mantém a destrutiva, mas marcada", () => {
    const drop = offerableActions(ACTIONS).find((a) => a.id === "drop")
    expect(drop).toBeDefined()
    expect(drop!.only_in_app).toBe(true)
  })

  it("expõe suppress_days para o modelo saber o custo da escolha", () => {
    const done = offerableActions(ACTIONS).find((a) => a.id === "done")
    expect(done!.suppress_days).toBe(7)
    expect(done!.only_in_app).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/mcp/tools/whats-stuck.test.ts`
Expected: FAIL — `offerableActions` não é exportada

- [ ] **Step 3: Implementar**

Em `src/lib/mcp/tools/whats-stuck.ts`, acrescente antes da tool:

```ts
import { isDestructive } from "./answer-with-action"

export interface OfferedAction {
  id: string
  label: string
  suppress_days: number
  /** A ação existe no app mas answer_with_action recusa: ela apaga. */
  only_in_app: boolean
}

// Ação de rascunho fica de fora: ela só abre um painel, não escreve nada e tem
// suppressDays 0. No chat o Claude redige o texto direto, sem tool nenhuma.
export function offerableActions(actions: CopilotQuickAction[]): OfferedAction[] {
  return actions
    .filter((a) => !a.effects.some((e) => e.kind === "open_drafts"))
    .map((a) => ({
      id: a.id,
      label: a.label,
      suppress_days: a.suppressDays,
      only_in_app: isDestructive(a),
    }))
}
```

E o `map` das pendências passa a usar:

```ts
        suggested_answers: offerableActions(q.actions),
```

Com o import de `CopilotQuickAction` de `@/types/copilot`.

A destrutiva **continua listada**, marcada com `only_in_app`. Esconder seria pior: você veria quatro opções no app e três no chat, sem explicação.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run`
Expected: PASS.

Run: `npx tsc --noEmit` e `npx eslint src/lib/mcp/`
Expected: limpos.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/tools/whats-stuck.ts src/lib/mcp/tools/whats-stuck.test.ts
git commit -m "feat(mcp): whats_stuck mostra o custo e o limite de cada resposta"
```

---

## Task 6: Verificar contra o banco e publicar

**Files:**
- Nenhum arquivo novo. Verificação e deploy.

- [ ] **Step 1: Subir e listar as tools**

Com `npm run dev` (confira a porta):

```bash
TOKEN=$(grep '^MCP_DEV_TOKEN=' .env.local | cut -d= -f2)
curl -s -X POST localhost:3003/api/mcp -H 'content-type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const t=JSON.parse(d).result.tools;console.log(t.length+' tools');t.forEach(x=>console.log(' -',x.name))})"
```

Expected: **15 tools**, com `answer_with_action` logo após `whats_stuck`, e `snooze_copilot_question` no lugar de `answer_copilot_question`.

- [ ] **Step 2: Ver as opções de uma pendência real**

Chame `whats_stuck` e confira uma pendência de `next_step_overdue`: as opções devem trazer `suppress_days`, a de rascunho não deve aparecer, e a `drop` deve vir com `only_in_app: true`.

- [ ] **Step 3: Responder por ação pronta**

Escolha uma pendência real e uma ação **não** destrutiva. Anote o `question_key`, chame `answer_with_action`, e confira três coisas:

```bash
node --env-file=.env.local -e "
const U=process.env.NEXT_PUBLIC_SUPABASE_URL,S=process.env.SUPABASE_SERVICE_ROLE_KEY;
const h={apikey:S,Authorization:'Bearer '+S};
(async()=>{
  const since=new Date(Date.now()-600e3).toISOString();
  const ev=await (await fetch(U+'/rest/v1/copilot_question_events?select=question_key,status,action_id,applied,suppress_until&created_at=gte.'+since,{headers:h})).json();
  console.log(JSON.stringify(ev,null,2));
})();
"
```

Expected: uma linha, `status: answered`, `action_id` preenchido, e **`applied` com os efeitos** — não `null`, que é como estão as 64 linhas antigas.

Depois chame `whats_stuck` de novo: aquela pendência não deve mais aparecer.

- [ ] **Step 4: Responder por narração**

Numa outra empresa, chame `log_activity` passando `answers_question_key`. Confira que a resposta traz `suppressed: true` e que existe uma linha nova em `copilot_question_events` com `applied.tool = "log_activity"`.

Depois repita com uma chave de **outra** empresa: a atividade deve ser registrada e a resposta deve trazer `suppressed: false` com o motivo — sem linha nova de evento.

- [ ] **Step 5: Confirmar a recusa da destrutiva**

Chame `answer_with_action` com a ação `drop` de uma pendência `next_step_overdue`.

Expected: erro dizendo que a opção apaga e que precisa ser feita no app. E o próximo passo **continua existindo** no banco.

- [ ] **Step 6: Confirmar a recusa da pendência obsoleta**

Chame `answer_with_action` de novo com o mesmo `question_key` do Step 3.

Expected: erro dizendo que a pendência não está mais na fila.

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
```

Expected: `Fluxo OAuth conforme.` — e o `tools/list` de produção com 15 tools.

- [ ] **Step 9: Commit**

Nada a commitar se os passos passaram. Se algum exigiu correção, commit junto da correção.

---

## Estado ao fim da Fatia 3

- Tirar uma pendência da fila como tratada exige ter escrito algo. A tool que suprime sem trabalho se chama `snooze` e não aceita `answered`.
- As respostas prontas que a fila já mostrava agora executam, com os efeitos do app.
- A coluna `applied` passa a registrar o que foi feito em cada resposta.
- A invariante "nenhuma tool apaga" continua valendo, e a única ação que a violaria é recusada com explicação.
