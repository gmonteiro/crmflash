# Copiloto: fila inteira com cobrança proporcional — plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O painel mostra todas as contas com pendência, e uma conta que o usuário viu e passou adiante fica quieta por um prazo proporcional à importância de cada pendência.

**Architecture:** `detectQuestions` perde o corte diário por padrão (o MCP continua pedindo 6). Um novo status `seen` em `copilot_question_events`, com cadência por regra em `SEEN_SUPPRESS_DAYS`, é gravado por um rastreador puro (`seen-tracker.ts`) que o painel alimenta com a conta em foco. "Adiar conta"/"Adiar tudo" usam a mesma cadência.

**Tech Stack:** Next.js (app router), Supabase, vitest, date-fns.

## Global Constraints

- Semântica de supressão: `suppress_until = hoje + N`; escondido enquanto `suppress_until >= hoje`. N=0 volta amanhã.
- `copilot_question_events` é append-only; `seen` nunca leva `action_id`, `answer_text` ou `applied`.
- Dwell mínimo para "visto": 3000 ms. Fechar a página não grava nada.
- Divisor da lateral: "Hoje" para `priority >= 80`, "Quando der" abaixo.
- Toasts: `"${nome} adiada"` e `"Perguntas adiadas"` (sem prometer "amanhã").
- Spec: `docs/superpowers/specs/2026-09-10-copiloto-fila-inteira-design.md`.
- Rodar testes: `npm test` (vitest run). Tipos: `npx tsc --noEmit`.

---

### Task 1: Cadência por regra e status `seen`

**Files:**
- Create: `supabase/migrations/018_copilot_seen.sql`
- Modify: `src/lib/constants.ts:75-95`
- Modify: `src/types/database.ts:254`
- Modify: `src/lib/pipeline/copilot-events.ts:13`
- Test: `src/lib/pipeline/copilot-events.test.ts` (novo)

**Interfaces:**
- Produces: `SEEN_SUPPRESS_DAYS: Record<CopilotRuleId, number>` em `@/lib/constants`; `recordCopilotEvent` aceita `status: "seen"`.

- [ ] **Step 1: Teste da tabela e do insert**

`src/lib/pipeline/copilot-events.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import { addDays, format } from "date-fns"
import { recordCopilotEvent } from "./copilot-events"
import { SEEN_SUPPRESS_DAYS } from "@/lib/constants"

describe("SEEN_SUPPRESS_DAYS", () => {
  it("urgente volta amanhã, higiene demora mais", () => {
    expect(SEEN_SUPPRESS_DAYS.meeting_yesterday).toBe(0)
    expect(SEEN_SUPPRESS_DAYS.next_step_overdue).toBe(0)
    const max = Math.max(...Object.values(SEEN_SUPPRESS_DAYS))
    expect(SEEN_SUPPRESS_DAYS.missing_pain_hypothesis).toBe(max)
    expect(SEEN_SUPPRESS_DAYS.stalled_card).toBeLessThan(SEEN_SUPPRESS_DAYS.missing_champion)
  })
})

describe("recordCopilotEvent — seen", () => {
  it("insere seen com campos de resposta nulos e suppress_until = hoje + N", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const supabase = { from: vi.fn(() => ({ insert })) } as never

    await recordCopilotEvent(supabase, {
      workspaceId: "ws",
      userId: "u",
      companyId: "c",
      questionKey: "missing_champion:c",
      ruleId: "missing_champion",
      status: "seen",
      suppressDays: 7,
    })

    expect(insert).toHaveBeenCalledTimes(1)
    const row = insert.mock.calls[0][0]
    expect(row.status).toBe("seen")
    expect(row.action_id).toBeNull()
    expect(row.answer_text).toBeNull()
    expect(row.applied).toBeNull()
    expect(row.suppress_until).toBe(format(addDays(new Date(), 7), "yyyy-MM-dd"))
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/pipeline/copilot-events.test.ts`
Expected: FAIL — `SEEN_SUPPRESS_DAYS` não exportado; tipo de `status` recusa `"seen"` (tsc).

- [ ] **Step 3: Migração**

`supabase/migrations/018_copilot_seen.sql`:

```sql
-- 018_copilot_seen.sql
-- Copiloto: status 'seen' em copilot_question_events.
--
-- O painel passou a mostrar a fila inteira. Para nao cobrar todo dia o que o
-- usuario ja viu e deixou passar, o painel grava 'seen' quando o card ficou na
-- tela e ele foi para outra conta. suppress_until vem de SEEN_SUPPRESS_DAYS
-- (src/lib/constants.ts), proporcional a importancia da regra.
--
-- 'seen' nunca carrega action_id, answer_text ou applied. Append-only como antes.
-- Rodar no Supabase SQL Editor.

ALTER TABLE copilot_question_events
  DROP CONSTRAINT IF EXISTS copilot_question_events_status_check;

ALTER TABLE copilot_question_events
  ADD CONSTRAINT copilot_question_events_status_check
  CHECK (status IN ('answered', 'snoozed', 'dismissed', 'seen'));

COMMENT ON COLUMN copilot_question_events.status IS
  'answered/snoozed/dismissed = resposta do usuario. seen = viu o card e passou adiante; suprime pela cadencia da regra.';
```

- [ ] **Step 4: Constantes e tipos**

Em `src/lib/constants.ts`, trocar o bloco das linhas 75-79 por:

```ts
// A fila é por EMPRESA: um card por conta, com todas as pendências dela dentro.
// COPILOT_MAX_PER_COMPANY é quantas pendências cabem num card — acima disso o
// card vira parede e ninguém responde. COPILOT_DAILY_LIMIT é o teto de empresas
// do MCP (whats_stuck): no chat a fila inteira é ruído. O painel não tem teto.
export const COPILOT_DAILY_LIMIT = 6
export const COPILOT_MAX_PER_COMPANY = 4

// Quando você viu o card de uma conta e passou adiante sem responder (ou clicou
// em Adiar), cada pendência some por estes dias. Proporcional à importância:
// reunião de ontem volta amanhã, hipótese de dor espera duas semanas.
// Semântica: suppress_until = hoje + N, escondido enquanto >= hoje. N=0 = amanhã.
export const SEEN_SUPPRESS_DAYS: Record<CopilotRuleId, number> = {
  meeting_yesterday: 0,
  next_step_overdue: 0,
  no_next_step: 2,
  frozen_candidate: 3,
  stalled_card: 3,
  no_signal_past_stage: 7,
  exit_criteria_unmet: 7,
  missing_champion: 7,
  missing_pain_hypothesis: 14,
}
```

Em `src/types/database.ts:254`:

```ts
export type CopilotEventStatus = 'answered' | 'snoozed' | 'dismissed' | 'seen'
```

Em `src/lib/pipeline/copilot-events.ts:13`:

```ts
  status: "answered" | "snoozed" | "dismissed" | "seen"
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/lib/pipeline/copilot-events.test.ts && npx tsc --noEmit`
Expected: PASS, sem erros de tipo.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/018_copilot_seen.sql src/lib/constants.ts src/types/database.ts src/lib/pipeline/copilot-events.ts src/lib/pipeline/copilot-events.test.ts
git commit -m "feat(copiloto): status seen e cadencia de supressao por regra"
```

---

### Task 2: Detecção sem teto por padrão; MCP mantém 6

**Files:**
- Modify: `src/lib/pipeline/rules.ts:11-13,488-536`
- Modify: `src/lib/pipeline/rules.test.ts`
- Modify: `src/lib/mcp/tools/whats-stuck.ts:33-65`
- Modify: `src/lib/mcp/tools/whats-stuck.test.ts`

**Interfaces:**
- Produces: `detectQuestions(snap, suppressed, opts?)` sem `limit` não corta empresas; `effectiveLimit(limit?: number): number` exportada de `whats-stuck.ts`.

- [ ] **Step 1: Testes**

Em `src/lib/pipeline/rules.test.ts`, dentro do `describe("detectQuestions — tetos")`, adicionar:

```ts
  it("sem limit, nenhuma empresa fica de fora", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"]
    const queue = buildCompanyQueue(detectQuestions(snapshot(ids), new Set()))
    expect(queue).toHaveLength(8)
  })
```

Em `src/lib/mcp/tools/whats-stuck.test.ts`, adicionar import e bloco:

```ts
import { effectiveLimit, offerableActions } from "./whats-stuck"
import { COPILOT_DAILY_LIMIT } from "@/lib/constants"

describe("effectiveLimit", () => {
  it("sem valor, o chat usa o teto do MCP", () => {
    expect(effectiveLimit(undefined)).toBe(COPILOT_DAILY_LIMIT)
  })
  it("com valor, respeita o pedido", () => {
    expect(effectiveLimit(20)).toBe(20)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/pipeline/rules.test.ts src/lib/mcp/tools/whats-stuck.test.ts`
Expected: FAIL — fila com 6 em vez de 8; `effectiveLimit` não existe.

- [ ] **Step 3: Implementar**

`src/lib/pipeline/rules.ts`: remover `COPILOT_DAILY_LIMIT` do import (linha 11). Trocar a doc e o default:

```ts
export interface DetectOptions {
  /** Teto de EMPRESAS (a fila é agrupada por conta). Sem valor, não corta. */
  limit?: number
  /** Teto de pendências por empresa — é o que cabe num card. */
  maxPerCompany?: number
}
```

```ts
  const { limit = Infinity, maxPerCompany = COPILOT_MAX_PER_COMPANY } = opts
```

E o comentário do corte diário (linhas 527-530) passa a:

```ts
    // Teto de empresas (só o MCP usa; o painel mostra tudo). Só barra conta
    // NOVA — uma empresa que já entrou continua podendo somar pendências, senão
    // o corte cairia no meio de um card.
```

`src/lib/mcp/tools/whats-stuck.ts`: importar `COPILOT_DAILY_LIMIT` de `@/lib/constants` e adicionar antes de `const input`:

```ts
// O painel mostra a fila inteira; no chat isso vira ruído. Sem pedido
// explícito, o MCP corta em COPILOT_DAILY_LIMIT empresas.
export function effectiveLimit(limit: number | undefined): number {
  return limit ?? COPILOT_DAILY_LIMIT
}
```

E no handler:

```ts
    const questions = detectQuestions(snap, suppressed, { limit: effectiveLimit(limit) })
```

O `describe` do input `limit` passa a: `"Teto de empresas na fila. Sem valor, 6."`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/pipeline/rules.test.ts src/lib/mcp/tools/whats-stuck.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/rules.ts src/lib/pipeline/rules.test.ts src/lib/mcp/tools/whats-stuck.ts src/lib/mcp/tools/whats-stuck.test.ts
git commit -m "feat(copiloto): painel sem teto de empresas; MCP mantem 6"
```

---

### Task 3: Rastreador de "visto"

**Files:**
- Create: `src/lib/pipeline/seen-tracker.ts`
- Test: `src/lib/pipeline/seen-tracker.test.ts`

**Interfaces:**
- Produces: `createSeenTracker(minDwellMs = 3000): SeenTracker` com `focus(companyId: string | null, now: number): string | null` e `skip(companyId: string): void`.

- [ ] **Step 1: Testes**

`src/lib/pipeline/seen-tracker.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { createSeenTracker } from "./seen-tracker"

describe("createSeenTracker", () => {
  it("trocar antes do dwell mínimo não conta como visto", () => {
    const t = createSeenTracker(3000)
    expect(t.focus("a", 0)).toBeNull()
    expect(t.focus("b", 2999)).toBeNull()
  })

  it("trocar depois do dwell devolve a conta que saiu", () => {
    const t = createSeenTracker(3000)
    t.focus("a", 0)
    expect(t.focus("b", 3000)).toBe("a")
  })

  it("a mesma conta só é devolvida uma vez", () => {
    const t = createSeenTracker(3000)
    t.focus("a", 0)
    expect(t.focus("b", 5000)).toBe("a")
    t.focus("a", 6000)
    expect(t.focus("b", 20000)).toBeNull()
  })

  it("refocar a mesma conta não devolve nada nem reinicia o relógio", () => {
    const t = createSeenTracker(3000)
    t.focus("a", 0)
    expect(t.focus("a", 1000)).toBeNull()
    expect(t.focus("b", 3000)).toBe("a")
  })

  it("focus(null) zera sem devolver", () => {
    const t = createSeenTracker(3000)
    t.focus("a", 0)
    expect(t.focus(null, 10000)).toBeNull()
    expect(t.focus("b", 10001)).toBeNull()
  })

  it("conta marcada com skip nunca é devolvida", () => {
    const t = createSeenTracker(3000)
    t.focus("a", 0)
    t.skip("a")
    expect(t.focus("b", 9000)).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/pipeline/seen-tracker.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

`src/lib/pipeline/seen-tracker.ts`:

```ts
// Decide quando o usuário "viu" o card de uma conta e passou adiante.
//
// Por que é uma função pura e não um efeito no painel: a regra tem três
// condições (ficou tempo suficiente, foi para OUTRA conta, ainda não foi
// tratada nesta sessão) e cada uma já quebrou sozinha em rascunho. Com o
// relógio injetado dá para testar sem React nem timers falsos.
//
// Quem consome: copilot-panel chama focus() toda vez que a conta em foco muda
// e skip() antes de responder/adiar, para a conta que sai por resposta não
// ser gravada como "vista".

export interface SeenTracker {
  /** Conta que entrou em foco (null = fila vazia). Devolve a que saiu e merece
   *  'seen', ou null. */
  focus(companyId: string | null, now: number): string | null
  /** Conta já tratada (respondida, adiada): focus nunca mais a devolve. */
  skip(companyId: string): void
}

export function createSeenTracker(minDwellMs = 3000): SeenTracker {
  let current: { companyId: string; since: number } | null = null
  const handled = new Set<string>()

  return {
    focus(companyId, now) {
      if (current && current.companyId === companyId) return null

      let left: string | null = null
      if (
        current &&
        !handled.has(current.companyId) &&
        now - current.since >= minDwellMs
      ) {
        left = current.companyId
        handled.add(left)
      }

      current = companyId ? { companyId, since: now } : null
      return left
    },
    skip(companyId) {
      handled.add(companyId)
    },
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/pipeline/seen-tracker.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/seen-tracker.ts src/lib/pipeline/seen-tracker.test.ts
git commit -m "feat(copiloto): rastreador puro de card visto"
```

---

### Task 4: Hook — `markSeen` e adiar por cadência

**Files:**
- Modify: `src/hooks/use-copilot.ts:14,160-190,254-266,404-436`

**Interfaces:**
- Consumes: `SEEN_SUPPRESS_DAYS`, `recordCopilotEvent` com `"seen"`.
- Produces: `markSeen(item: CompanyQueueItem): Promise<void>`; `snoozeCompany(item: CompanyQueueItem): Promise<boolean>` (sem `days`); `snoozeAll()` com cadência por regra.

Não há teste de hook no projeto (nenhum `renderHook`); a cobertura vem de Task 1 (insert) e Task 3 (decisão). Verificação: `tsc` e o teste manual da Task 6.

- [ ] **Step 1: Import**

```ts
import { COMMITMENT_SIGNALS, NARRATION_SUPPRESS_DAYS, SEEN_SUPPRESS_DAYS } from "@/lib/constants"
```

- [ ] **Step 2: `recordEvent` aceita `seen`**

Na assinatura interna de `recordEvent` (linha 167):

```ts
        status: "answered" | "snoozed" | "dismissed" | "seen"
```

- [ ] **Step 3: `snoozeAll` por cadência**

Substituir o corpo:

```ts
  // Adia todas as contas abertas. Cada pendência volta no prazo da própria
  // regra: reunião de ontem amanhã, hipótese de dor em duas semanas.
  const snoozeAll = useCallback(async (): Promise<boolean> => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !workspaceId) return false

    const pending = questions
    setQuestions([])
    for (const q of pending) {
      await recordEvent(supabase, user.id, q, {
        status: "snoozed",
        suppressDays: SEEN_SUPPRESS_DAYS[q.ruleId],
      })
    }
    return true
  }, [workspaceId, questions, recordEvent])
```

- [ ] **Step 4: `snoozeCompany` por cadência e `markSeen`**

Substituir `snoozeCompany` e adicionar `markSeen` logo abaixo:

```ts
  // Adiar a conta inteira: "não aconteceu nada aqui", sem passar pela IA.
  // Mesma cadência do "visto": o que é urgente volta amanhã de qualquer jeito.
  const snoozeCompany = useCallback(
    async (item: CompanyQueueItem): Promise<boolean> => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !workspaceId) return false

      setQuestions((prev) => prev.filter((q) => q.companyId !== item.companyId))
      for (const pending of item.pendings) {
        await recordEvent(supabase, user.id, pending, {
          status: "snoozed",
          suppressDays: SEEN_SUPPRESS_DAYS[pending.ruleId],
        })
      }
      return true
    },
    [workspaceId, recordEvent]
  )

  // O usuário viu o card e foi para outra conta. Não mexe na fila da sessão
  // (ele pode voltar); só no próximo load cada pendência some pelo prazo dela.
  const markSeen = useCallback(
    async (item: CompanyQueueItem): Promise<void> => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !workspaceId) return

      for (const pending of item.pendings) {
        await recordEvent(supabase, user.id, pending, {
          status: "seen",
          suppressDays: SEEN_SUPPRESS_DAYS[pending.ruleId],
        })
      }
    },
    [workspaceId, recordEvent]
  )
```

E no `return`, adicionar `markSeen,` depois de `snoozeCompany,`.

- [ ] **Step 5: Tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-copilot.ts
git commit -m "feat(copiloto): markSeen e adiar com cadencia por regra"
```

---

### Task 5: Painel — rastreador, lateral inteira com divisor, toasts

**Files:**
- Modify: `src/components/copilot/copilot-panel.tsx`

**Interfaces:**
- Consumes: `createSeenTracker`, `markSeen`, `snoozeCompany(item)`.

- [ ] **Step 1: Imports e rastreador**

```ts
import { useState, useCallback, useEffect, useRef } from "react"
import { createSeenTracker } from "@/lib/pipeline/seen-tracker"
```

Dentro de `CopilotPanel`, depois de `const copilot = useCopilot()` e da desestruturação (adicionar `markSeen` nela):

```ts
  // Um rastreador por montagem do painel: a sessão é a vida do componente.
  const seenTracker = useRef(createSeenTracker())
```

Depois de `const pendingCount = ...`:

```ts
  // Toda troca de conta em foco pergunta ao rastreador se a anterior foi vista.
  // O item é procurado na fila da sessão, que ainda o contém (seen não remove).
  const currentCompanyId = current?.companyId ?? null
  useEffect(() => {
    const left = seenTracker.current.focus(currentCompanyId, Date.now())
    if (!left) return
    const item = queue.find((c) => c.companyId === left)
    if (item) void markSeen(item)
    // queue muda a cada resposta, mas só a troca de foco deve disparar isto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompanyId, markSeen])
```

- [ ] **Step 2: `skip` antes de escrever**

Em `handleAction`, antes de `setBusy(true)`:

```ts
      seenTracker.current.skip(question.companyId)
```

Em `handleApplyProposal`, antes de `setBusy(true)`:

```ts
      seenTracker.current.skip(current.companyId)
```

Em `handleSnoozeCompany`, antes de `setBusy(true)`:

```ts
    seenTracker.current.skip(current.companyId)
```

Em `handleSnoozeAll`, antes de `const ok = await snoozeAll()`:

```ts
    for (const item of queue) seenTracker.current.skip(item.companyId)
```

E na dependência de `handleSnoozeAll` incluir `queue`.

- [ ] **Step 3: Toasts**

```ts
      toast.success(`${current.companyName} adiada`)
```

```ts
      toast.success("Perguntas adiadas")
```

- [ ] **Step 4: Lateral inteira com divisor**

Trocar o bloco `{queue.length > 1 && (...)}` por:

```tsx
            {queue.length > 0 && (
              <div className="space-y-2 lg:border-l lg:pl-6">
                <p className="text-xs font-medium text-muted-foreground">
                  Na fila ({queue.length})
                </p>
                <div className="max-h-[32rem] space-y-1 overflow-y-auto pr-1">
                  {queue.map((item, i) => {
                    const group = queueGroup(item.priority)
                    const showLabel = i === 0 || queueGroup(queue[i - 1].priority) !== group
                    return (
                      <div key={item.companyId}>
                        {showLabel && (
                          <p className={cn("px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground", i > 0 && "pt-3")}>
                            {group === "today" ? "Hoje" : "Quando der"}
                          </p>
                        )}
                        <button
                          onClick={() => setSelectedCompanyId(item.companyId)}
                          className={cn(
                            "w-full rounded-md border p-2 text-left transition-colors hover:bg-muted/50",
                            item.companyId === current.companyId
                              ? "border-violet-500/50 bg-violet-500/5"
                              : "border-transparent"
                          )}
                        >
                          <span className="flex items-center gap-1.5 text-xs font-medium">
                            <Building2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                            <span className="truncate">{item.companyName}</span>
                            <span className="ml-auto shrink-0 text-[11px] font-normal text-muted-foreground">
                              {item.pendings.length}
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                            {item.pendings[0]?.title}
                          </span>
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
```

E no topo do arquivo (fora do componente), depois de `INTERPRET_ERROR_MESSAGE`:

```ts
// "Hoje" é o que pede ação agora: reunião, passo vencido, sem passo, gelado e
// parado (prioridade >= 80). O resto é higiene do card e pode esperar.
const TODAY_PRIORITY = 80
const queueGroup = (priority: number): "today" | "later" =>
  priority >= TODAY_PRIORITY ? "today" : "later"
```

- [ ] **Step 5: Tipos e lint**

Run: `npx tsc --noEmit && npx eslint src/components/copilot/copilot-panel.tsx src/hooks/use-copilot.ts`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/components/copilot/copilot-panel.tsx
git commit -m "feat(copiloto): lateral inteira com Hoje/Quando der e card visto"
```

---

### Task 6: Verificação ponta a ponta, docs e migração no banco

**Files:**
- Modify: `docs/specification.md:283`
- Modify: `docs/memory.md` (nova seção após "Copiloto: fila por empresa")

- [ ] **Step 1: Suite inteira**

Run: `npm test`
Expected: tudo verde.

- [ ] **Step 2: Migração no Supabase**

Rodar `supabase/migrations/018_copilot_seen.sql` no SQL Editor do projeto. Sem isso, o insert de `seen` falha no CHECK e o painel só não grava (o `recordCopilotEvent` não lança).

- [ ] **Step 3: Teste manual**

`npm run dev`, abrir `/dashboard`:
1. Badge mostra o total de contas, lateral com "Hoje"/"Quando der" e rolagem.
2. Ficar 3 s numa conta de higiene, clicar em outra, dar F5: a conta sumiu; conferir no banco uma linha `seen` por pendência com `suppress_until` = hoje + N.
3. Ficar 3 s numa conta com reunião de ontem, clicar em outra, F5: a conta some hoje (N=0 → `suppress_until` = hoje) e volta amanhã.
4. "Adiar conta" numa conta mista: toast "X adiada"; no banco, `snoozed` com N distinto por regra.

- [ ] **Step 4: Docs**

`docs/specification.md:283`:

```
- Teto de `COPILOT_MAX_PER_COMPANY` (4) pendências por empresa. O painel mostra todas as empresas; `COPILOT_DAILY_LIMIT` (6) é só o default do MCP (`whats_stuck`)
- Status `seen` (migration 018): viu o card e passou adiante. Suprime cada pendência por `SEEN_SUPPRESS_DAYS[ruleId]` (0 a 14 dias, proporcional à regra). "Adiar conta"/"Adiar tudo" usam a mesma cadência
```

`docs/memory.md`, nova seção após a de 2026-08-20:

```
## Copiloto: fila inteira (2026-09-10)

- **Sintoma:** "so mostra 6 na fila e a cada refresh aparece mais". Era
  `COPILOT_DAILY_LIMIT` escondendo o resto; cada resposta liberava uma vaga.
- **Decisao:** painel sem teto de empresas (`detectQuestions` default
  `Infinity`); `whats_stuck` continua em 6 por default (`effectiveLimit`).
- **Nao cobrar sempre:** status `seen` (migration 018). O painel grava quando o
  card ficou >= 3 s na tela e o usuario clicou em outra conta
  (`seen-tracker.ts`, puro, relogio injetado). Cada pendencia some por
  `SEEN_SUPPRESS_DAYS[ruleId]`: 0 (reuniao, passo vencido) a 14 (dor).
  "Adiar conta"/"Adiar tudo" usam a mesma tabela; deixaram de ser 1 dia fixo.
- **Semantica de N:** `suppress_until = hoje + N`, escondido enquanto `>= hoje`.
  N=0 volta amanha. O "adiar para amanha" antigo (N=1) escondia por dois dias.
- **Lateral:** lista inteira com rolagem e divisor Hoje (prioridade >= 80) /
  Quando der.
- **Design:** `docs/superpowers/specs/2026-09-10-copiloto-fila-inteira-design.md`
```

- [ ] **Step 5: Commit**

```bash
git add docs/specification.md docs/memory.md docs/superpowers/plans/2026-09-10-copiloto-fila-inteira.md
git commit -m "docs: copiloto com fila inteira e cobranca proporcional"
```
