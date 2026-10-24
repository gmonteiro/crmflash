# Pendências e mensagens sem retorno — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma página `/pendencias` (e uma faixa no dashboard e seções no resumo diário) com tudo que espera o Gabriel: conversas sem retorno nos dois sentidos, decisões abertas e alertas do sistema.

**Architecture:** Os eventos de e-mail e WhatsApp ganham `conversation_key` (026). Uma função pura `openItems` cruza eventos, dispensas, fila de identidade, propostas e marcas de execução dos crons, e devolve quatro listas. Página, dashboard, resumo diário e a tool `open_items` do MCP leem dela. Decidir e dispensar passam por duas rotas com a sessão do usuário (RLS), reaproveitando `resolveReview` e `decideInference`.

**Tech Stack:** Next 16 (App Router, client components), Supabase, vitest, shadcn/ui (`tabs`, `card`, `badge`, `button`).

**Spec:** `lumeis-lead-lifecycle/docs/superpowers/specs/2026-10-24-pendencias-e-sem-retorno-design.md`

## Global Constraints

- Conversa = `gmail:<threadId>` ou `whatsapp:<chatKey>`. Só e-mail e WhatsApp entram.
- Lado cliente: `email.received` com `client_engaged = true`, `whatsapp.received`. Lado Lumeis: `email.sent`, `whatsapp.sent`. O resto (inclusive `email.auto_reply`) é ignorado.
- Janela de 30 dias. "Aguardando o cliente" só a partir de 3 dias. No resumo: "aguardando você" > 24 h, "aguardando o cliente" > 7 dias.
- Idade em horas corridas.
- Alertas de sistema: batimento do WhatsApp > 24 h; marca de cron (`sync_cursors` `source='cron'`) > 26 h. Sem marca nenhuma → sem alerta (cron que nunca rodou desde este deploy).
  - **Desvio registrado do spec:** o spec pedia "revisão sem linha em `daily_reviews` ontem". A marca do cron `daily-review` cobre o mesmo caso e é o mesmo mecanismo dos outros crons; o spec é atualizado na Task 9.
- Estágio nunca muda sozinho. Na aba Decisões, aceitar `stage_suggestion` leva ao copiloto da conta (que move pelo `move_stage`); a rota de decisão recusa aceitar sugestão de estágio.
- Caso de identidade de projeto do TranscriptionApp ou de reunião (`observed.project_id` / `observed.meeting_id`) não se resolve na página: precisa reingerir, o que a tool `resolve_identity` faz. A página mostra "resolver no claude.ai".
- Textos de UI e comentários em português; código no estilo do repo (`src/lib/hub`: sem ponto e vírgula, aspas duplas).
- Migração aplicada à mão no SQL Editor do CRM (`mghvrbpadiawevdlxizr`), antes do deploy.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/026_pendencias.sql` (novo) | `activities.conversation_key` + backfill; `conversation_dismissals` |
| `src/lib/events/types.ts`, `record.ts` | `conversationKey` no `HubEventInput` |
| `src/lib/hub/store.ts` | `EventRow.conversationKey`; interface `OpenItemsStore` |
| `src/lib/hub/memory-store.ts`, `supabase-store.ts` | Gravam a coluna; implementam `OpenItemsStore` |
| `src/lib/hub/gmail-ingest.ts`, `whatsapp-ingest.ts` | Passam a chave |
| `src/lib/hub/open-items.ts` (novo) | `openItems()`: as quatro listas |
| `src/lib/hub/open-items.test.ts` (novo) | Regras |
| `src/lib/hub/daily-review.ts`, `sync.ts` | Seções novas no resumo |
| `src/app/api/cron/*/route.ts` | Marca de execução |
| `src/app/api/pendencias/route.ts`, `dismiss/route.ts`, `decide/route.ts` (novos) | Leitura, dispensa e decisão com sessão |
| `src/lib/mcp/tools/hub/open-items.ts` (novo), `registry.ts`, `registry.test.ts` | Tool `open_items` |
| `src/components/pendencias/*.tsx` (novos) | Abas, cartões, faixa do dashboard |
| `src/app/(dashboard)/pendencias/page.tsx` (novo), `dashboard/page.tsx`, `src/components/layout/sidebar.tsx` | Página, faixa, item de menu |

---

### Task 1: `conversation_key` (migração 026 e gravação)

**Files:**
- Create: `supabase/migrations/026_pendencias.sql`
- Modify: `src/lib/events/types.ts` (`HubEventInput`), `src/lib/events/record.ts`, `src/lib/hub/store.ts` (`EventRow`), `src/lib/hub/supabase-store.ts` (`upsertEvent`), `src/lib/hub/gmail-ingest.ts`, `src/lib/hub/whatsapp-ingest.ts`
- Test: `src/lib/hub/gmail-ingest.test.ts`, `src/lib/hub/whatsapp-ingest.test.ts`

**Interfaces:**
- Produces: `HubEventInput.conversationKey?: string | null`; `EventRow.conversationKey: string | null`; coluna `activities.conversation_key`; tabela `conversation_dismissals`.

- [ ] **Step 1: Testes**

Em `gmail-ingest.test.ts`, no teste "cliente escreveu…", acrescentar ao `toMatchObject` do evento: `conversationKey: "gmail:t-m1",`.

Em `whatsapp-ingest.test.ts`, no teste "cliente escreveu: whatsapp.received…", acrescentar: `conversationKey: "whatsapp:p:+5521987654321",`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/hub/gmail-ingest.test.ts src/lib/hub/whatsapp-ingest.test.ts`
Expected: os dois testes FAIL (`conversationKey` ausente).

- [ ] **Step 3: Plumbing**

- `types.ts`, em `HubEventInput`, depois de `transcript?`:
  ```ts
  /** Conversa de mensagem (e-mail por thread, WhatsApp por chat): a base de "sem retorno". */
  conversationKey?: string | null
  ```
- `store.ts`, em `EventRow`, depois de `processorVersion: string`: `conversationKey: string | null`.
- `record.ts`, no objeto do `upsertEvent`, depois de `transcript:`: `conversationKey: input.conversationKey ?? null,`.
- `supabase-store.ts`, no `payload` do `upsertEvent`, depois de `processor_version:`: `conversation_key: row.conversationKey,`. No ramo que atualiza por versão nova (o `update` com o payload), a coluna vai junto; conferir que esse ramo usa `payload` e não uma lista de campos à mão. Se for lista, acrescentar `conversation_key`.
- `gmail-ingest.ts`, no `recordEvent`, depois de `participants,`: `conversationKey: \`gmail:${m.threadId}\`,`.
- `whatsapp-ingest.ts`, no `recordEvent` de `recordDays`, depois de `participants,`: `conversationKey: \`whatsapp:${e.chatKey}\`,`.

O memory store guarda o `EventRow` inteiro, então não muda.

- [ ] **Step 4: Migração**

```sql
-- 026_pendencias.sql
--
-- 1. activities.conversation_key: a conversa de mensagem do evento.
--    gmail:<threadId> e whatsapp:<chatKey>. É a base de "sem retorno":
--    a última mensagem de cada lado, por conversa.
-- 2. Backfill dos eventos que já existem (idempotente).
-- 3. conversation_dismissals: "já resolvi" / "parar de esperar". Vale até
--    dismissed_through; mensagem nova do lado pendente traz a conversa de volta.
--
-- RODAR INTEIRA, DE UMA VEZ, NO SUPABASE SQL EDITOR, ANTES DO DEPLOY.

begin;

alter table activities add column if not exists conversation_key text;
create index if not exists idx_activities_conversation
  on activities (workspace_id, conversation_key, occurred_at)
  where conversation_key is not null;

-- Gmail: o threadId está no link da evidência (…/#all/<threadId>).
update activities
   set conversation_key = 'gmail:' || substring(evidence -> 0 ->> 'url' from '#all/([^/?#]+)$')
 where source = 'gmail'
   and conversation_key is null
   and evidence -> 0 ->> 'url' like '%#all/%';

-- WhatsApp: source_id = <chatKey>:<AAAA-MM-DD>.
update activities
   set conversation_key = 'whatsapp:' || regexp_replace(source_id, ':\d{4}-\d{2}-\d{2}$', '')
 where source = 'whatsapp'
   and conversation_key is null;

create table if not exists conversation_dismissals (
  workspace_id uuid not null default default_workspace() references workspaces (id) on delete cascade,
  conversation_key text not null,
  side text not null check (side in ('client', 'lumeis')),
  dismissed_through timestamptz not null,
  reason text,
  dismissed_by uuid,
  created_at timestamptz not null default now(),
  primary key (workspace_id, conversation_key, side)
);

do $rls$
begin
  if not exists (select 1 from pg_policies where tablename = 'conversation_dismissals') then
    alter table conversation_dismissals enable row level security;
    create policy conversation_dismissals_ws_select on conversation_dismissals for select using (workspace_id = current_workspace());
    create policy conversation_dismissals_ws_insert on conversation_dismissals for insert with check (workspace_id = current_workspace());
    create policy conversation_dismissals_ws_update on conversation_dismissals for update using (workspace_id = current_workspace()) with check (workspace_id = current_workspace());
  end if;
end
$rls$;

commit;

-- Conferência: nenhuma linha de gmail/whatsapp sem chave.
-- select source, count(*) filter (where conversation_key is null) as sem_chave, count(*) from activities
--  where source in ('gmail','whatsapp') group by source;
```

- [ ] **Step 5: Rodar**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS. Se algum teste montar `EventRow` à mão e reclamar de `conversationKey`, acrescentar `conversationKey: null` nele.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/026_pendencias.sql src/lib/events src/lib/hub
git commit -m "feat(pendencias): conversation_key nos eventos de e-mail e WhatsApp (026)"
```

---

### Task 2: Marca de execução dos crons

**Files:**
- Modify: `src/app/api/cron/calendar-sync/route.ts`, `gmail-sync/route.ts`, `transcripts-sync/route.ts`, `daily-review/route.ts`
- Create: `src/lib/hub/crons.ts`

**Interfaces:**
- Produces: `CRON_NAMES`, `CronName` e `markCronRun(store: HubStore, name: CronName): Promise<void>`, exportados de `src/lib/hub/crons.ts` (arquivo próprio para `sync.ts` e `open-items.ts` importarem sem ciclo). Cursor gravado: `("cron", <ISO>, <name>)`.

- [ ] **Step 1: `crons.ts`**

```ts
import type { HubStore } from "./store"

/** Os crons da Vercel. A aba Sistema alerta se algum ficar mais de 26 h sem rodar. */
export const CRON_NAMES = ["calendar-sync", "gmail-sync", "transcripts-sync", "daily-review"] as const
export type CronName = (typeof CRON_NAMES)[number]

/** Grava que o cron terminou sem erro. Só no caminho de sucesso da rota. */
export async function markCronRun(store: HubStore, name: CronName): Promise<void> {
  await store.setCursor("cron", new Date().toISOString(), name)
}
```

- [ ] **Step 2: Chamar nas rotas**

Em cada uma das quatro rotas, trocar o `return NextResponse.json(await runX(store))` por:

```ts
    const result = await runGmailSync(store) // o run da rota
    await markCronRun(store, "gmail-sync")
    return NextResponse.json(result)
```

Na `daily-review`, marcar só quando não houver `company_id` (revisão de uma conta só não é o cron). Ler cada rota antes de editar: a forma do `try` muda um pouco entre elas.

- [ ] **Step 3: Typecheck e commit**

Run: `npx tsc --noEmit`

```bash
git add src/app/api/cron src/lib/hub/crons.ts
git commit -m "feat(pendencias): crons gravam a última execução"
```

---

### Task 3: `openItems` — a lógica

**Files:**
- Modify: `src/lib/hub/store.ts` (interface `OpenItemsStore` e tipos)
- Modify: `src/lib/hub/memory-store.ts`
- Create: `src/lib/hub/open-items.ts`
- Test: `src/lib/hub/open-items.test.ts`

**Interfaces:**
- Consumes: `EventRow.conversationKey` (Task 1); `CRON_NAMES` de `./crons` (Task 2); `heartbeatAlert`, `WHATSAPP_HEARTBEAT_MAX_MS` de `daily-review.ts`.
- Produces:
  ```ts
  // store.ts
  export interface ConversationEventRow {
    conversationKey: string
    kind: EventKind
    clientEngaged: boolean
    occurredAt: string
    companyId: string
    companyName: string
    title: string
    description: string | null
    url: string | null
  }
  export interface DismissalRow { conversationKey: string; side: "client" | "lumeis"; dismissedThrough: string }
  export interface OpenReviewItemRow {
    id: string
    reason: string
    observed: Record<string, unknown>
    candidates: ReviewCandidate[]
    companyId: string | null
    companyName: string | null
    createdAt: string
  }
  export interface ProposedInferenceRow { id: string; companyId: string; companyName: string; field: string; value: unknown; createdAt: string }
  export interface CursorRow { source: string; key: string; cursor: string | null; updatedAt: string }
  export interface OpenItemsStore {
    conversationEvents(sinceISO: string): Promise<ConversationEventRow[]>
    dismissals(): Promise<DismissalRow[]>
    dismissConversation(d: DismissalRow & { reason: string | null; dismissedBy: string | null }): Promise<void>
    openReviewItems(): Promise<OpenReviewItemRow[]>
    proposedInferences(): Promise<ProposedInferenceRow[]>
    systemCursors(): Promise<CursorRow[]>
  }

  // open-items.ts
  export interface ConversationItem {
    conversationKey: string
    channel: "gmail" | "whatsapp"
    companyId: string
    companyName: string
    title: string
    preview: string | null
    url: string | null
    lastAt: string
    ageHours: number
  }
  export interface DecisionItem {
    kind: "identity" | "proposal"
    id: string
    companyId: string | null
    companyName: string | null
    title: string
    detail: string
    createdAt: string
    /** identity: dá para resolver na página (não é projeto nem reunião). proposal: não é estágio. */
    decidableHere: boolean
    candidates: ReviewCandidate[]
    field: string | null
  }
  export interface SystemItem { key: string; message: string; since: string | null }
  export interface OpenItems {
    generatedAt: string
    waitingYou: ConversationItem[]
    waitingClient: ConversationItem[]
    decisions: DecisionItem[]
    system: SystemItem[]
  }
  export const WINDOW_DAYS = 30
  export const WAITING_CLIENT_MIN_HOURS = 72
  export const CRON_STALE_MS = 26 * 60 * 60 * 1000
  export async function openItems(store: OpenItemsStore, opts: { now: number }): Promise<OpenItems>
  ```

- [ ] **Step 1: Tipos e interface em `store.ts`**

Acrescentar ao fim de `store.ts` os tipos e a interface `OpenItemsStore` acima, exatamente como estão. `EventKind` e `ReviewCandidate` já estão no arquivo ou no import de `@/lib/events/types`; conferir os imports.

- [ ] **Step 2: Implementação em memória**

Em `memory-store.ts`: acrescentar os tipos novos ao import de `./store`, declarar `implements …, OpenItemsStore` e inserir antes de `async getCursor(`:

```ts
  // --- pendências ---
  dismissalRows = new Map<string, DismissalRow>() // key|side
  /** Quando cada cursor foi gravado, para a aba Sistema. */
  cursorUpdatedAt = new Map<string, string>()

  async conversationEvents(sinceISO: string): Promise<ConversationEventRow[]> {
    return [...this.events.values()]
      .filter((e) => e.conversationKey && e.occurredAt >= sinceISO)
      .map((e) => ({
        conversationKey: e.conversationKey!,
        kind: e.kind,
        clientEngaged: e.clientEngaged,
        occurredAt: e.occurredAt,
        companyId: e.companyId,
        companyName: this.companies.get(e.companyId)?.name ?? "?",
        title: e.title,
        description: e.description,
        url: e.evidence[0]?.url ?? null,
      }))
  }

  async dismissals() {
    return [...this.dismissalRows.values()]
  }

  async dismissConversation(d: DismissalRow & { reason: string | null; dismissedBy: string | null }) {
    this.dismissalRows.set(`${d.conversationKey}|${d.side}`, {
      conversationKey: d.conversationKey,
      side: d.side,
      dismissedThrough: d.dismissedThrough,
    })
  }

  async openReviewItems(): Promise<OpenReviewItemRow[]> {
    return [...this.reviews.values()]
      .filter((r) => r.status === "open")
      .map((r) => ({
        id: r.id,
        reason: r.reason,
        observed: r.observed,
        candidates: r.candidates,
        companyId: r.companyId,
        companyName: r.companyId ? this.companies.get(r.companyId)?.name ?? null : null,
        createdAt: "",
      }))
  }

  async proposedInferences(): Promise<ProposedInferenceRow[]> {
    return [...this.inferences.values()]
      .filter((i) => i.status === "proposed")
      .map((i) => ({
        id: i.id,
        companyId: i.companyId,
        companyName: this.companies.get(i.companyId)?.name ?? "?",
        field: i.field,
        value: i.value,
        createdAt: "",
      }))
  }

  async systemCursors(): Promise<CursorRow[]> {
    return [...this.cursors.entries()]
      .map(([k, cursor]) => {
        const [source, key] = k.split("|")
        return { source, key, cursor, updatedAt: this.cursorUpdatedAt.get(k) ?? "" }
      })
      .filter((c) => c.source === "cron" || c.source === "whatsapp")
  }

```

- [ ] **Step 3: Testes**

```ts
// src/lib/hub/open-items.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import { MemoryHubStore } from "./memory-store"
import { recordEvent } from "@/lib/events/record"
import { openItems } from "./open-items"
import type { EventKind } from "@/lib/events/types"

const NOW = Date.parse("2026-10-24T15:00:00Z")
const H = 3_600_000
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()
let store: MemoryHubStore

beforeEach(() => {
  store = new MemoryHubStore()
  store.addCompany({ id: "co-acme", name: "Acme" })
})

let seq = 0
async function msg(conversationKey: string, kind: EventKind, agoMs: number, over: { fromClient?: boolean; autoReply?: boolean } = {}) {
  const source = conversationKey.startsWith("gmail:") ? "gmail" : "whatsapp"
  await recordEvent(store, {
    source,
    sourceId: `m${++seq}`,
    kind,
    companyId: "co-acme",
    occurredAt: iso(agoMs),
    direction: kind.endsWith(".sent") ? "outbound" : "inbound",
    title: `${kind} ${seq}`,
    description: `texto ${seq}`,
    facts: { fromClient: over.fromClient ?? true, autoReply: over.autoReply ?? false },
    evidence: [{ kind: source === "gmail" ? "email" : "whatsapp", ref: `m${seq}`, url: source === "gmail" ? `https://mail.google.com/mail/u/0/#all/${conversationKey.slice(6)}` : undefined }],
    conversationKey,
  })
}
const run = () => openItems(store, { now: NOW })

describe("aguardando você", () => {
  it("cliente escreveu por último: aparece, com a idade da última mensagem dele", async () => {
    await msg("gmail:t1", "email.sent", 30 * H)
    await msg("gmail:t1", "email.received", 5 * H)
    const r = await run()
    expect(r.waitingYou.map((x) => [x.conversationKey, x.channel, x.ageHours])).toEqual([["gmail:t1", "gmail", 5]])
    expect(r.waitingYou[0]).toMatchObject({ companyName: "Acme", url: "https://mail.google.com/mail/u/0/#all/t1", preview: "texto 2" })
    expect(r.waitingClient).toEqual([])
  })

  it("Lumeis respondeu depois: sai da lista", async () => {
    await msg("whatsapp:p:+5521987654321", "whatsapp.received", 5 * H)
    await msg("whatsapp:p:+5521987654321", "whatsapp.sent", 4 * H)
    expect((await run()).waitingYou).toEqual([])
  })

  it("é por conversa: duas threads da mesma conta são duas pendências, a mais antiga primeiro", async () => {
    await msg("gmail:t1", "email.received", 2 * H)
    await msg("gmail:t2", "email.received", 9 * H)
    expect((await run()).waitingYou.map((x) => x.conversationKey)).toEqual(["gmail:t2", "gmail:t1"])
  })

  it("resposta automática não conta como cliente", async () => {
    await msg("gmail:t1", "email.sent", 100 * H)
    await msg("gmail:t1", "email.auto_reply", 1 * H, { autoReply: true })
    const r = await run()
    expect(r.waitingYou).toEqual([])
    expect(r.waitingClient.map((x) => x.conversationKey)).toEqual(["gmail:t1"])
  })

  it("dispensar tira; mensagem nova do cliente depois traz de volta", async () => {
    await msg("gmail:t1", "email.received", 5 * H)
    await store.dismissConversation({ conversationKey: "gmail:t1", side: "client", dismissedThrough: iso(5 * H), reason: "era obrigado", dismissedBy: null })
    expect((await run()).waitingYou).toEqual([])
    await msg("gmail:t1", "email.received", 1 * H)
    expect((await run()).waitingYou.map((x) => x.ageHours)).toEqual([1])
  })

  it("conversa fora dos 30 dias não aparece", async () => {
    await msg("gmail:velha", "email.received", 31 * 24 * H)
    expect((await run()).waitingYou).toEqual([])
  })
})

describe("aguardando o cliente", () => {
  it("só depois de 3 dias", async () => {
    await msg("gmail:t1", "email.sent", 71 * H)
    await msg("gmail:t2", "email.sent", 73 * H)
    expect((await run()).waitingClient.map((x) => x.conversationKey)).toEqual(["gmail:t2"])
  })

  it("parar de esperar tira", async () => {
    await msg("gmail:t2", "email.sent", 100 * H)
    await store.dismissConversation({ conversationKey: "gmail:t2", side: "lumeis", dismissedThrough: iso(100 * H), reason: null, dismissedBy: null })
    expect((await run()).waitingClient).toEqual([])
  })
})

describe("decisões", () => {
  it("casos da fila (com e sem empresa) e propostas; projeto e estágio não se decidem na página", async () => {
    await store.openReview({ dedupKey: "a", companyId: null, reason: "dominio_desconhecido", observed: { domain: "novaco.com", source: "gmail" }, candidates: [] })
    await store.openReview({ dedupKey: "b", companyId: null, reason: "projeto_sem_empresa", observed: { project_id: "p1", project_name: "Piloto" }, candidates: [] })
    await store.insertInference({ companyId: "co-acme", field: "stage_suggestion", value: { target_stage: "Prova" }, evidence: [], sourceActivityId: "x", sourceVersion: "1", model: "m", promptVersion: "p", status: "proposed" })
    await store.insertInference({ companyId: "co-acme", field: "pain_hypothesis", value: { value: "conciliação manual" }, evidence: [], sourceActivityId: "x", sourceVersion: "1", model: "m", promptVersion: "p", status: "proposed" })
    const d = (await run()).decisions
    expect(d.map((x) => [x.kind, x.title, x.decidableHere])).toEqual([
      ["identity", "Domínio novo: novaco.com", true],
      ["identity", "Projeto do TranscriptionApp sem empresa: Piloto", false],
      ["proposal", "Acme: mover para Prova", false],
      ["proposal", "Acme: dor — conciliação manual", true],
    ])
  })
})

describe("sistema", () => {
  it("batimento do WhatsApp velho e cron parado alertam; cron que nunca rodou não", async () => {
    await store.setCursor("whatsapp", iso(30 * H), "heartbeat")
    await store.setCursor("cron", iso(27 * H), "gmail-sync")
    await store.setCursor("cron", iso(2 * H), "calendar-sync")
    const s = (await run()).system
    expect(s.map((x) => x.key)).toEqual(["whatsapp-heartbeat", "cron:gmail-sync"])
    expect(s[1].message).toContain("gmail-sync")
  })
})
```

Notas para o teste:

- `recordEvent` grava `occurredAt` com `toISOString`, e o evento recebe `conversationKey` porque a Task 1 passou o campo adiante.
- A marca do cron é o **valor** do cursor (ISO). Por isso a lógica lê `cursor`, não `updatedAt`: `systemCursors` devolve os dois, e o `updatedAt` fica só como diagnóstico.

- [ ] **Step 4: Rodar e ver falhar**

Run: `npx vitest run src/lib/hub/open-items.test.ts`
Expected: FAIL (`./open-items` não existe).

- [ ] **Step 5: Implementar `open-items.ts`**

```ts
import type { EventKind } from "@/lib/events/types"
import { CRON_NAMES } from "./crons"
import { heartbeatAlert } from "./daily-review"
import type { ConversationEventRow, OpenItemsStore, ReviewCandidate } from "./store"

// TUDO QUE ESPERA O GABRIEL. Uma função, quatro listas, lidas pela página
// /pendencias, pela faixa do dashboard, pelo resumo diário e pela tool
// open_items. "Sem retorno" é calculado na hora, sobre os eventos dos últimos
// 30 dias: não há tabela derivada para ficar velha.
//
//   aguardando você     → a última mensagem do CLIENTE na conversa é a mais nova;
//   aguardando o cliente → a última da LUMEIS é a mais nova, há ≥ 3 dias;
//   decisões            → fila de identidade aberta + propostas da IA;
//   sistema             → coletor de WhatsApp ou cron parado.

export const WINDOW_DAYS = 30
export const WAITING_CLIENT_MIN_HOURS = 72
export const CRON_STALE_MS = 26 * 60 * 60 * 1000
const HOUR = 3_600_000

export interface ConversationItem {
  conversationKey: string
  channel: "gmail" | "whatsapp"
  companyId: string
  companyName: string
  title: string
  preview: string | null
  url: string | null
  lastAt: string
  ageHours: number
}

export interface DecisionItem {
  kind: "identity" | "proposal"
  id: string
  companyId: string | null
  companyName: string | null
  title: string
  detail: string
  createdAt: string
  decidableHere: boolean
  candidates: ReviewCandidate[]
  field: string | null
}

export interface SystemItem {
  key: string
  message: string
  since: string | null
}

export interface OpenItems {
  generatedAt: string
  waitingYou: ConversationItem[]
  waitingClient: ConversationItem[]
  decisions: DecisionItem[]
  system: SystemItem[]
}

function sideOf(kind: EventKind, clientEngaged: boolean): "client" | "lumeis" | null {
  if (kind === "whatsapp.received") return "client"
  if (kind === "email.received") return clientEngaged ? "client" : null
  if (kind === "email.sent" || kind === "whatsapp.sent") return "lumeis"
  return null
}

function toItem(e: ConversationEventRow, now: number): ConversationItem {
  return {
    conversationKey: e.conversationKey,
    channel: e.conversationKey.startsWith("gmail:") ? "gmail" : "whatsapp",
    companyId: e.companyId,
    companyName: e.companyName,
    title: e.title,
    preview: e.description ? e.description.slice(-200) : null,
    url: e.url,
    lastAt: e.occurredAt,
    ageHours: Math.floor((now - Date.parse(e.occurredAt)) / HOUR),
  }
}

const REASON_TITLE: Record<string, (o: Record<string, unknown>) => string> = {
  dominio_desconhecido: (o) => `Domínio novo: ${o.domain}`,
  email_generico_desconhecido: (o) => `E-mail pessoal sem dono: ${o.name ?? o.email}`,
  homonimos_na_empresa: (o) => `Quem é ${o.name ?? o.email}?`,
  projeto_sem_empresa: (o) => `Projeto do TranscriptionApp sem empresa: ${o.project_name ?? o.project_id}`,
  whatsapp_contato: (o) => `Contato do WhatsApp: ${o.name}`,
  grupo_sem_empresa: (o) => `Grupo do WhatsApp: ${o.group_name}`,
}

const FIELD_LABEL: Record<string, string> = {
  pain_hypothesis: "dor",
  champion: "campeão",
  economic_buyer: "decisor",
}

function proposalTitle(companyName: string, field: string, value: unknown): string {
  const v = (value ?? {}) as { target_stage?: string; value?: string; title?: string }
  if (field === "stage_suggestion") return `${companyName}: mover para ${v.target_stage ?? "?"}`
  if (field.startsWith("next_step:")) return `${companyName}: próximo passo — ${v.title ?? "?"}`
  return `${companyName}: ${FIELD_LABEL[field] ?? field} — ${v.value ?? "?"}`
}

export async function openItems(store: OpenItemsStore, opts: { now: number }): Promise<OpenItems> {
  const { now } = opts
  const since = new Date(now - WINDOW_DAYS * 24 * HOUR).toISOString()
  const [events, dismissals, reviews, inferences, cursors] = await Promise.all([
    store.conversationEvents(since),
    store.dismissals(),
    store.openReviewItems(),
    store.proposedInferences(),
    store.systemCursors(),
  ])

  // Última mensagem de cada lado, por conversa.
  const last = new Map<string, { client?: ConversationEventRow; lumeis?: ConversationEventRow }>()
  for (const e of events) {
    const side = sideOf(e.kind, e.clientEngaged)
    if (!side) continue
    const cur = last.get(e.conversationKey) ?? {}
    if (!cur[side] || cur[side]!.occurredAt < e.occurredAt) cur[side] = e
    last.set(e.conversationKey, cur)
  }
  const dismissedThrough = (key: string, side: "client" | "lumeis") =>
    dismissals.find((d) => d.conversationKey === key && d.side === side)?.dismissedThrough ?? null

  const waitingYou: ConversationItem[] = []
  const waitingClient: ConversationItem[] = []
  for (const [key, { client, lumeis }] of last) {
    if (client && (!lumeis || client.occurredAt > lumeis.occurredAt)) {
      const d = dismissedThrough(key, "client")
      if (!d || Date.parse(d) < Date.parse(client.occurredAt)) waitingYou.push(toItem(client, now))
    } else if (lumeis) {
      const d = dismissedThrough(key, "lumeis")
      const item = toItem(lumeis, now)
      if (item.ageHours >= WAITING_CLIENT_MIN_HOURS && (!d || Date.parse(d) < Date.parse(lumeis.occurredAt))) waitingClient.push(item)
    }
  }
  const oldestFirst = (a: ConversationItem, b: ConversationItem) => a.lastAt.localeCompare(b.lastAt)
  waitingYou.sort(oldestFirst)
  waitingClient.sort(oldestFirst)

  const decisions: DecisionItem[] = [
    ...reviews.map((r) => ({
      kind: "identity" as const,
      id: r.id,
      companyId: r.companyId,
      companyName: r.companyName,
      title: (REASON_TITLE[r.reason] ?? ((o: Record<string, unknown>) => String(o.name ?? o.email ?? o.domain ?? r.reason)))(r.observed),
      detail: r.reason.replace(/_/g, " "),
      createdAt: r.createdAt,
      decidableHere: !r.observed.project_id && !r.observed.meeting_id,
      candidates: r.candidates,
      field: null,
    })),
    ...inferences.map((i) => ({
      kind: "proposal" as const,
      id: i.id,
      companyId: i.companyId,
      companyName: i.companyName,
      title: proposalTitle(i.companyName, i.field, i.value),
      detail: i.field.startsWith("next_step:") ? "next step" : i.field.replace(/_/g, " "),
      createdAt: i.createdAt,
      decidableHere: i.field !== "stage_suggestion",
      candidates: [],
      field: i.field,
    })),
  ]

  const system: SystemItem[] = []
  const beat = cursors.find((c) => c.source === "whatsapp" && c.key === "heartbeat")?.cursor ?? null
  const beatMsg = heartbeatAlert(beat, now)
  if (beatMsg) system.push({ key: "whatsapp-heartbeat", message: beatMsg, since: beat })
  for (const name of CRON_NAMES) {
    const at = cursors.find((c) => c.source === "cron" && c.key === name)?.cursor ?? null
    if (at && now - Date.parse(at) > CRON_STALE_MS) {
      system.push({ key: `cron:${name}`, message: `O cron ${name} não roda desde ${at.slice(0, 16).replace("T", " ")} UTC.`, since: at })
    }
  }

  return { generatedAt: new Date(now).toISOString(), waitingYou, waitingClient, decisions, system }
}
```

- [ ] **Step 6: Rodar**

Run: `npx vitest run src/lib/hub/open-items.test.ts && npx tsc --noEmit`
Expected: PASS (10 testes) e `tsc` sem erros (a classe Supabase só declara a interface na Task 4).

- [ ] **Step 7: Commit**

```bash
git add src/lib/hub/open-items.ts src/lib/hub/open-items.test.ts src/lib/hub/store.ts src/lib/hub/memory-store.ts
git commit -m "feat(pendencias): openItems — sem retorno nos dois sentidos, decisões e sistema"
```

---

### Task 4: `OpenItemsStore` no Supabase e as três rotas

**Files:**
- Modify: `src/lib/hub/supabase-store.ts`
- Create: `src/app/api/pendencias/route.ts`, `src/app/api/pendencias/dismiss/route.ts`, `src/app/api/pendencias/decide/route.ts`

**Interfaces:**
- Consumes: `OpenItemsStore` (Task 3); `openItems`; `resolveReview`, `decideInference` (`decisions.ts`); `getWorkspaceId` (`@/lib/workspace/server`); `createServerSupabaseClient`; `verifyCsrfOrigin`.
- Produces:
  - `GET /api/pendencias` → `OpenItems`;
  - `POST /api/pendencias/dismiss` `{conversation_key, side, through, reason?}` → `{ok}`;
  - `POST /api/pendencias/decide` `{type: "review", id, resolution: ReviewResolution} | {type: "inference", id, decision: "accept" | "reject"}` → `DecisionResult`.

- [ ] **Step 1: `SupabaseHubStore implements … OpenItemsStore`**

Inserir antes de `async getCursor(`:

```ts
  // --- pendências (026) ----------------------------------------------------

  async conversationEvents(sinceISO: string): Promise<ConversationEventRow[]> {
    const rows = await this.allRows<Row>("conversationEvents", (a, b) =>
      this.db
        .from("activities")
        .select("conversation_key, kind, client_engaged, occurred_at, company_id, title, description, evidence, companies(name)")
        .eq("workspace_id", this.workspaceId)
        .not("conversation_key", "is", null)
        .gte("occurred_at", sinceISO)
        .range(a, b)
    )
    return rows.map((r) => {
      const co = r.companies as unknown as { name: string } | { name: string }[] | null
      const ev = (r.evidence as { url?: string }[] | null) ?? []
      return {
        conversationKey: r.conversation_key as string,
        kind: r.kind as ConversationEventRow["kind"],
        clientEngaged: !!r.client_engaged,
        occurredAt: new Date(r.occurred_at as string).toISOString(),
        companyId: r.company_id as string,
        companyName: (Array.isArray(co) ? co[0]?.name : co?.name) ?? "?",
        title: r.title as string,
        description: (r.description as string) ?? null,
        url: ev[0]?.url ?? null,
      }
    })
  }

  async dismissals(): Promise<DismissalRow[]> {
    const { data, error } = await this.db
      .from("conversation_dismissals")
      .select("conversation_key, side, dismissed_through")
      .eq("workspace_id", this.workspaceId)
    if (error) fail("dismissals", error)
    return (data ?? []).map((d) => ({
      conversationKey: d.conversation_key as string,
      side: d.side as DismissalRow["side"],
      dismissedThrough: d.dismissed_through as string,
    }))
  }

  async dismissConversation(d: DismissalRow & { reason: string | null; dismissedBy: string | null }) {
    const { error } = await this.db.from("conversation_dismissals").upsert(
      this.ws({
        conversation_key: d.conversationKey,
        side: d.side,
        dismissed_through: d.dismissedThrough,
        reason: d.reason,
        dismissed_by: d.dismissedBy,
        created_at: new Date().toISOString(),
      }),
      { onConflict: "workspace_id,conversation_key,side" }
    )
    if (error) fail("dismissConversation", error)
  }

  async openReviewItems(): Promise<OpenReviewItemRow[]> {
    const { data, error } = await this.db
      .from("identity_reviews")
      .select("id, reason, observed, candidates, company_id, created_at, companies(name)")
      .eq("workspace_id", this.workspaceId)
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .limit(500)
    if (error) fail("openReviewItems", error)
    return (data ?? []).map((r) => {
      const co = r.companies as unknown as { name: string } | { name: string }[] | null
      return {
        id: r.id as string,
        reason: r.reason as string,
        observed: (r.observed as Record<string, unknown>) ?? {},
        candidates: (r.candidates as ReviewCandidate[]) ?? [],
        companyId: (r.company_id as string) ?? null,
        companyName: (Array.isArray(co) ? co[0]?.name : co?.name) ?? null,
        createdAt: r.created_at as string,
      }
    })
  }

  async proposedInferences(): Promise<ProposedInferenceRow[]> {
    const { data, error } = await this.db
      .from("inferences")
      .select("id, company_id, field, value, created_at, companies(name)")
      .eq("workspace_id", this.workspaceId)
      .eq("status", "proposed")
      .order("created_at", { ascending: true })
      .limit(500)
    if (error) fail("proposedInferences", error)
    return (data ?? []).map((r) => {
      const co = r.companies as unknown as { name: string } | { name: string }[] | null
      return {
        id: r.id as string,
        companyId: r.company_id as string,
        companyName: (Array.isArray(co) ? co[0]?.name : co?.name) ?? "?",
        field: r.field as string,
        value: r.value,
        createdAt: r.created_at as string,
      }
    })
  }

  async systemCursors(): Promise<CursorRow[]> {
    const { data, error } = await this.db
      .from("sync_cursors")
      .select("source, key, cursor, updated_at")
      .eq("workspace_id", this.workspaceId)
      .in("source", ["cron", "whatsapp"])
    if (error) fail("systemCursors", error)
    return (data ?? []).map((c) => ({
      source: c.source as string,
      key: c.key as string,
      cursor: (c.cursor as string) ?? null,
      updatedAt: c.updated_at as string,
    }))
  }

```

Os imports de `./store` ganham `ConversationEventRow, CursorRow, DismissalRow, OpenItemsStore, OpenReviewItemRow, ProposedInferenceRow, ReviewCandidate` (este último, se ainda não estiver).

- [ ] **Step 2: A sessão vira store**

Acrescentar ao fim de `src/lib/workspace/server.ts`:

```ts
/** O hub store com o cliente do usuário: a RLS escopa leitura e escrita ao workspace dele. */
export async function sessionHubStore() {
  const { createServerSupabaseClient } = await import("@/lib/supabase/server")
  const { SupabaseHubStore } = await import("@/lib/hub/supabase-store")
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const workspaceId = await getWorkspaceId(supabase, user.id)
  if (!workspaceId) return null
  return { supabase, userId: user.id, workspaceId, store: new SupabaseHubStore(supabase, workspaceId, user.id) }
}
```

Conferir antes a assinatura de `getWorkspaceId` nesse arquivo e usar a mesma.

- [ ] **Step 3: As rotas**

```ts
// src/app/api/pendencias/route.ts
import { NextResponse } from "next/server"
import { openItems } from "@/lib/hub/open-items"
import { sessionHubStore } from "@/lib/workspace/server"

export const dynamic = "force-dynamic"

export async function GET() {
  const s = await sessionHubStore()
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json(await openItems(s.store, { now: Date.now() }))
}
```

```ts
// src/app/api/pendencias/dismiss/route.ts
import { NextResponse } from "next/server"
import { z } from "zod"
import { verifyCsrfOrigin } from "@/lib/utils"
import { sessionHubStore } from "@/lib/workspace/server"

const body = z.object({
  conversation_key: z.string().regex(/^(gmail|whatsapp):.+/).max(200),
  side: z.enum(["client", "lumeis"]),
  through: z.string().datetime(),
  reason: z.string().trim().max(300).nullable().default(null),
})

export async function POST(request: Request) {
  if (!verifyCsrfOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const s = await sessionHubStore()
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Validation failed" }, { status: 400 })
  await s.store.dismissConversation({
    conversationKey: parsed.data.conversation_key,
    side: parsed.data.side,
    dismissedThrough: parsed.data.through,
    reason: parsed.data.reason,
    dismissedBy: s.userId,
  })
  return NextResponse.json({ ok: true })
}
```

```ts
// src/app/api/pendencias/decide/route.ts
import { NextResponse } from "next/server"
import { z } from "zod"
import { decideInference, resolveReview } from "@/lib/hub/decisions"
import { verifyCsrfOrigin } from "@/lib/utils"
import { sessionHubStore } from "@/lib/workspace/server"

const resolution = z.discriminatedUnion("type", [
  z.object({ type: z.literal("link_person"), personId: z.string().uuid() }),
  z.object({ type: z.literal("link_company"), companyId: z.string().uuid() }),
  z.object({ type: z.literal("create_company"), name: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal("ignore") }),
])
const body = z.discriminatedUnion("type", [
  z.object({ type: z.literal("review"), id: z.string().uuid(), resolution }),
  z.object({ type: z.literal("inference"), id: z.string().uuid(), decision: z.enum(["accept", "reject"]) }),
])

// Estágio nunca muda daqui: aceitar sugestão de estágio é no copiloto da conta,
// que move pelo move_stage. Caso de projeto/reunião precisa reingerir (MCP).
export async function POST(request: Request) {
  if (!verifyCsrfOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const s = await sessionHubStore()
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Validation failed" }, { status: 400 })
  const ctx = { workspaceId: s.workspaceId, userId: s.userId }

  if (parsed.data.type === "inference") {
    const { data: inf } = await s.supabase.from("inferences").select("field").eq("id", parsed.data.id).maybeSingle()
    if (inf?.field === "stage_suggestion" && parsed.data.decision === "accept") {
      return NextResponse.json({ ok: false, detail: "Sugestão de estágio se aceita no copiloto da conta." }, { status: 400 })
    }
    return NextResponse.json(await decideInference(s.supabase, ctx, parsed.data.id, parsed.data.decision))
  }

  const { data: rev } = await s.supabase.from("identity_reviews").select("observed").eq("id", parsed.data.id).maybeSingle()
  const obs = (rev?.observed ?? {}) as { project_id?: string; meeting_id?: string }
  if (obs.project_id || obs.meeting_id) {
    return NextResponse.json({ ok: false, detail: "Projeto e reunião se resolvem no claude.ai (resolve_identity), que reprocessa as transcrições." }, { status: 400 })
  }
  return NextResponse.json(await resolveReview(s.supabase, ctx, parsed.data.id, parsed.data.resolution))
}
```

`/api/pendencias` não entra em `publicRoutes` do middleware: é rota com sessão, e o middleware deve exigir o login.

- [ ] **Step 4: Typecheck e suíte**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hub/supabase-store.ts src/lib/workspace/server.ts src/app/api/pendencias
git commit -m "feat(pendencias): leitura, dispensa e decisão com a sessão do usuário"
```

---

### Task 5: Resumo diário

**Files:**
- Modify: `src/lib/hub/daily-review.ts` (`composeDigest`)
- Modify: `src/lib/hub/sync.ts` (`runDailyReviewAndDigest`)
- Test: `src/lib/hub/daily-review.test.ts`

**Interfaces:**
- Consumes: `openItems`, `ConversationItem` (Task 3).
- Produces: `composeDigest(today, rows, openDecisions, appUrl, alerts = [], pend = { waitingYou: [], waitingClient: [] })`, com `pend.waitingYou` já filtrado (> 24 h) e `pend.waitingClient` já filtrado (> 7 dias).

- [ ] **Step 1: Testes**

Em `daily-review.test.ts`:

- No teste "ordem: riscos, sugestões, fila, avanços", trocar `"Fila de identidade"` por `"Decisões abertas"`.
- Acrescentar:

```ts
describe("resumo: pendências", () => {
  const conv = (key: string, ageHours: number) => ({
    conversationKey: key,
    channel: "gmail" as const,
    companyId: "a",
    companyName: "Acme",
    title: "E-mail: proposta",
    preview: "pode mandar?",
    url: null,
    lastAt: "2026-10-23T10:00:00.000Z",
    ageHours,
  })

  it("aguardando você sozinho já faz o e-mail sair, e vem antes dos riscos", () => {
    const d = composeDigest("2026-10-24", [], 0, "https://crm.example", [], { waitingYou: [conv("gmail:t1", 30)], waitingClient: [] })!
    expect(d.subject).toBe("CRM 2026-10-24: 1 aguardando você")
    expect(d.html).toContain("Aguardando você (1)")
    expect(d.html).toContain('href="https://crm.example/pendencias"')
  })

  it("ordem: sistema, aguardando você, aguardando o cliente, riscos", () => {
    const rows = [
      { companyId: "b", companyName: "B", reviewDate: "2026-10-24", verdict: "risco" as const, rationale: "sumiu", evidenceActivityIds: [], model: "m", promptVersion: "p", stageSuggestion: null, nextStep: null },
    ]
    const d = composeDigest("2026-10-24", rows, 3, "https://crm.example", ["WhatsApp parado"], {
      waitingYou: [conv("gmail:t1", 30)],
      waitingClient: [conv("gmail:t2", 200)],
    })!
    const order = ["WhatsApp parado", "Aguardando você", "Aguardando o cliente", "Riscos", "Decisões abertas"].map((h) => d.html.indexOf(h))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((x, y) => x - y))
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/hub/daily-review.test.ts`
Expected: os testes novos FAIL.

- [ ] **Step 3: `composeDigest`**

- Renomear o parâmetro `openIdentity` para `openDecisions` e acrescentar `pend: { waitingYou: ConversationItem[]; waitingClient: ConversationItem[] } = { waitingYou: [], waitingClient: [] }` depois de `alerts`. Importar `type ConversationItem` de `./open-items`.
- Guarda de saída: `if (!alerts.length && !pend.waitingYou.length && !pend.waitingClient.length && !risco.length && !sugestoes.length && !avanco.length && openDecisions === 0) return null`.
- Antes do `html`, acrescentar:
  ```ts
  const ago = (h: number) => (h >= 48 ? `${Math.floor(h / 24)} dias` : `${h} h`)
  const conv = (c: ConversationItem) =>
    `<li><a href="${appUrl}/companies/${c.companyId}"><b>${esc(c.companyName)}</b></a>: ${esc(c.title)} — há ${ago(c.ageHours)}${c.preview ? ` <i>“${esc(c.preview.slice(-140))}”</i>` : ""}</li>`
  const pendLink = `<p><a href="${appUrl}/pendencias">Abrir Pendências</a></p>`
  ```
- No array `html`, logo depois da linha dos `alerts` e **antes** de `<p>Revisão de…`:
  ```ts
    section(`Aguardando você (${pend.waitingYou.length})`, pend.waitingYou.map(conv)),
    section(`Aguardando o cliente (${pend.waitingClient.length})`, pend.waitingClient.map(conv)),
    pend.waitingYou.length || pend.waitingClient.length ? pendLink : "",
  ```
- Trocar a linha `openIdentity ? … Fila de identidade …` por:
  ```ts
    openDecisions ? `<h3>Decisões abertas</h3><p>${openDecisions} esperando você em <a href="${appUrl}/pendencias">Pendências</a>.</p>` : "",
  ```
- `parts` do assunto ganha, **no começo**: `pend.waitingYou.length ? \`${pend.waitingYou.length} aguardando você\` : null,`. O fallback continua: `parts.join(", ") || (alerts.length ? "alerta do sistema" : \`${openDecisions} decisões abertas\`)`. Atualizar o teste da Task 5 da fase 4 que espera `"alerta do WhatsApp"`: trocar para `"alerta do sistema"`.
- `counts` ganha `aguardandoVoce: pend.waitingYou.length, aguardandoCliente: pend.waitingClient.length`, e `fila` vira `decisoes: openDecisions`. Procurar quem lê `counts.fila` (`grep -rn "counts" src/lib/hub src/lib/mcp`) e ajustar.

- [ ] **Step 4: `runDailyReviewAndDigest`**

Trocar o bloco dos `alerts` e do `composeDigest` por:

```ts
  // Tudo que espera você, da mesma função da página /pendencias.
  const items = await openItems(store, { now: Date.now() })
  const digest = composeDigest(
    review.today,
    await store.reviewsOn(review.today),
    items.decisions.length,
    appUrl,
    items.system.map((s) => s.message),
    {
      waitingYou: items.waitingYou.filter((c) => c.ageHours > 24),
      waitingClient: items.waitingClient.filter((c) => c.ageHours > 7 * 24),
    }
  )
```

A assinatura vira `store: HubStore & DailyReviewStore & OpenItemsStore`. A rota `daily-review` e a tool `daily_review` passam `SupabaseHubStore`, que já implementa as três. Remover o import de `heartbeatAlert` de `sync.ts`: o alerta agora vem de `items.system`.

- [ ] **Step 5: Rodar**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/hub/daily-review.ts src/lib/hub/daily-review.test.ts src/lib/hub/sync.ts
git commit -m "feat(pendencias): resumo diário abre com sistema e conversas sem retorno"
```

---

### Task 6: Tool `open_items` no MCP

**Files:**
- Create: `src/lib/mcp/tools/hub/open-items.ts`
- Modify: `src/lib/mcp/registry.ts`, `src/lib/mcp/registry.test.ts`

**Interfaces:**
- Consumes: `openItems`; `McpIdentity`; `SupabaseHubStore`.
- Produces: tool `open_items`, sem argumentos, que devolve `OpenItems`.

- [ ] **Step 1: A tool**

```ts
import { z } from "zod"
import { openItems } from "@/lib/hub/open-items"
import { SupabaseHubStore } from "@/lib/hub/supabase-store"
import type { McpTool } from "../../registry"

const input = z.object({})

export const openItemsTool: McpTool<typeof input> = {
  name: "open_items",
  description:
    "Tudo que está esperando você, a mesma lista da página Pendências: conversas de e-mail e " +
    "WhatsApp em que o cliente escreveu por último e ninguém respondeu (aguardando você), " +
    "conversas em que você escreveu e o cliente está há 3+ dias sem responder (aguardando o " +
    "cliente), decisões abertas (fila de identidade e propostas da IA) e alertas do sistema " +
    "(coletor de WhatsApp ou cron parado). Use para responder 'o que está pendente?'.",
  input,
  async handler(identity) {
    // Leitura com o cliente do usuário: a RLS escopa ao workspace dele.
    const store = new SupabaseHubStore(identity.supabase, identity.workspaceId, identity.userId)
    return openItems(store, { now: Date.now() })
  },
}
```

- [ ] **Step 2: Registrar**

Em `registry.ts`, importar `openItemsTool` de `./tools/hub/open-items` e acrescentá-lo à lista de tools, ao lado de `dailyReview`. Em `registry.test.ts`: `expect(TOOLS).toHaveLength(30)`.

- [ ] **Step 3: Rodar e commit**

Run: `npx vitest run src/lib/mcp && npx tsc --noEmit`

```bash
git add src/lib/mcp
git commit -m "feat(pendencias): tool open_items no MCP"
```

---

### Task 7: Página `/pendencias`, faixa no dashboard e menu

**Files:**
- Create: `src/hooks/use-open-items.ts`
- Create: `src/components/pendencias/conversation-list.tsx`, `decision-list.tsx`, `open-items-strip.tsx`
- Create: `src/app/(dashboard)/pendencias/page.tsx`
- Modify: `src/app/(dashboard)/dashboard/page.tsx`, `src/components/layout/sidebar.tsx`

**Interfaces:**
- Consumes: `GET /api/pendencias`, `POST /api/pendencias/dismiss`, `POST /api/pendencias/decide` (Task 4); tipos de `@/lib/hub/open-items` (só `import type`).
- Produces: `useOpenItems(): { data: OpenItems | null; loading: boolean; error: string | null; reload(): Promise<void>; dismiss(c: ConversationItem, side: "client" | "lumeis", reason: string | null): Promise<void>; decide(body: DecideBody): Promise<{ ok: boolean; detail: string }> }`.

O repo não tem jsdom, então esta task não tem teste automático: a verificação é o roteiro do Step 6.

- [ ] **Step 1: Hook**

```ts
// src/hooks/use-open-items.ts
"use client"

import { useCallback, useEffect, useState } from "react"
import type { ConversationItem, OpenItems } from "@/lib/hub/open-items"
import type { ReviewResolution } from "@/types/copilot"

export type DecideBody =
  | { type: "review"; id: string; resolution: ReviewResolution }
  | { type: "inference"; id: string; decision: "accept" | "reject" }

async function post(path: string, body: unknown) {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  return (await res.json().catch(() => ({ ok: false, detail: `HTTP ${res.status}` }))) as { ok: boolean; detail?: string }
}

export function useOpenItems() {
  const [data, setData] = useState<OpenItems | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/pendencias", { cache: "no-store" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData((await res.json()) as OpenItems)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const dismiss = useCallback(
    async (c: ConversationItem, side: "client" | "lumeis", reason: string | null) => {
      await post("/api/pendencias/dismiss", { conversation_key: c.conversationKey, side, through: c.lastAt, reason })
      await reload()
    },
    [reload]
  )

  const decide = useCallback(
    async (body: DecideBody) => {
      const r = await post("/api/pendencias/decide", body)
      await reload()
      return { ok: !!r.ok, detail: r.detail ?? "" }
    },
    [reload]
  )

  return { data, loading, error, reload, dismiss, decide }
}
```

- [ ] **Step 2: Lista de conversas**

```tsx
// src/components/pendencias/conversation-list.tsx
"use client"

import Link from "next/link"
import { Mail, MessageCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { ConversationItem } from "@/lib/hub/open-items"

const ago = (h: number) => (h >= 48 ? `${Math.floor(h / 24)} dias` : h >= 1 ? `${h} h` : "agora")

export function ConversationList({
  items,
  empty,
  dismissLabel,
  onDismiss,
}: {
  items: ConversationItem[]
  empty: string
  dismissLabel: string
  onDismiss: (c: ConversationItem) => void
}) {
  if (!items.length) return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>
  return (
    <div className="space-y-2">
      {items.map((c) => (
        <Card key={c.conversationKey}>
          <CardContent className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 text-sm">
                {c.channel === "gmail" ? <Mail className="h-4 w-4 shrink-0" /> : <MessageCircle className="h-4 w-4 shrink-0" />}
                <Link href={`/companies/${c.companyId}`} className="font-medium hover:underline">
                  {c.companyName}
                </Link>
                <Badge variant={c.ageHours > 24 ? "destructive" : "secondary"}>há {ago(c.ageHours)}</Badge>
              </div>
              <p className="truncate text-sm">{c.title}</p>
              {c.preview && <p className="line-clamp-2 text-xs text-muted-foreground">“{c.preview}”</p>}
            </div>
            <div className="flex shrink-0 gap-2">
              {c.url && (
                <Button asChild size="sm" variant="outline">
                  <a href={c.url} target="_blank" rel="noreferrer">
                    Abrir
                  </a>
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => onDismiss(c)}>
                {dismissLabel}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
```

Conferir se o `Button` do repo aceita `asChild` (shadcn new-york aceita). Se não aceitar, usar `<a className={buttonVariants({ size: "sm", variant: "outline" })}>`.

- [ ] **Step 3: Lista de decisões**

```tsx
// src/components/pendencias/decision-list.tsx
"use client"

import Link from "next/link"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { DecideBody } from "@/hooks/use-open-items"
import type { DecisionItem } from "@/lib/hub/open-items"

export function DecisionList({ items, onDecide }: { items: DecisionItem[]; onDecide: (b: DecideBody) => Promise<{ ok: boolean; detail: string }> }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<Record<string, string>>({})
  if (!items.length) return <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma decisão esperando você.</p>

  async function run(id: string, body: DecideBody) {
    setBusy(id)
    const r = await onDecide(body)
    setBusy(null)
    if (!r.ok) setMsg((m) => ({ ...m, [id]: r.detail || "Não deu certo." }))
  }

  return (
    <div className="space-y-2">
      {items.map((d) => (
        <Card key={`${d.kind}:${d.id}`}>
          <CardContent className="space-y-2 py-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline">{d.kind === "identity" ? "identidade" : "proposta"}</Badge>
              <span className="font-medium">{d.title}</span>
              {d.companyId && d.kind === "identity" && (
                <Link href={`/companies/${d.companyId}`} className="text-xs text-muted-foreground hover:underline">
                  {d.companyName}
                </Link>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{d.detail}</p>

            {!d.decidableHere && d.kind === "identity" && (
              <p className="text-xs">Resolver no claude.ai: <code>resolve_identity</code> reprocessa as transcrições do projeto ou da reunião.</p>
            )}
            {!d.decidableHere && d.kind === "proposal" && d.companyId && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/companies/${d.companyId}`}>Decidir no copiloto da conta</Link>
              </Button>
            )}

            {d.decidableHere && d.kind === "identity" && (
              <div className="flex flex-wrap gap-2">
                {d.candidates.slice(0, 3).map((c, i) =>
                  c.personId ? (
                    <Button key={i} size="sm" disabled={busy === d.id} onClick={() => run(d.id, { type: "review", id: d.id, resolution: { type: "link_person", personId: c.personId! } })}>
                      É {c.label}
                    </Button>
                  ) : c.companyId ? (
                    <Button key={i} size="sm" disabled={busy === d.id} onClick={() => run(d.id, { type: "review", id: d.id, resolution: { type: "link_company", companyId: c.companyId! } })}>
                      É da {c.label}
                    </Button>
                  ) : null
                )}
                <Button size="sm" variant="ghost" disabled={busy === d.id} onClick={() => run(d.id, { type: "review", id: d.id, resolution: { type: "ignore" } })}>
                  Ignorar
                </Button>
              </div>
            )}
            {d.decidableHere && d.kind === "proposal" && (
              <div className="flex gap-2">
                <Button size="sm" disabled={busy === d.id} onClick={() => run(d.id, { type: "inference", id: d.id, decision: "accept" })}>
                  Aceitar
                </Button>
                <Button size="sm" variant="ghost" disabled={busy === d.id} onClick={() => run(d.id, { type: "inference", id: d.id, decision: "reject" })}>
                  Recusar
                </Button>
              </div>
            )}
            {msg[d.id] && <p className="text-xs text-destructive">{msg[d.id]}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Página e faixa**

```tsx
// src/app/(dashboard)/pendencias/page.tsx
"use client"

import { Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ConversationList } from "@/components/pendencias/conversation-list"
import { DecisionList } from "@/components/pendencias/decision-list"
import { useOpenItems } from "@/hooks/use-open-items"
import type { ConversationItem } from "@/lib/hub/open-items"

const TABS = ["you", "client", "decisions", "system"] as const

function Pendencias() {
  const { data, loading, error, dismiss, decide } = useOpenItems()
  const params = useSearchParams()
  const tab = TABS.find((t) => t === params.get("tab")) ?? "you"
  // Dispensar pede o motivo num diálogo (nada de window.prompt).
  const [pending, setPending] = useState<{ c: ConversationItem; side: "client" | "lumeis" } | null>(null)
  const [reason, setReason] = useState("")

  async function confirmDismiss() {
    if (!pending) return
    await dismiss(pending.c, pending.side, reason.trim() || null)
    setPending(null)
    setReason("")
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Pendências</h1>
        <p className="text-sm text-muted-foreground">Tudo que está esperando você. Nada aqui muda estágio sozinho.</p>
      </div>
      {error && <p className="text-sm text-destructive">Não consegui carregar: {error}</p>}
      {loading && !data ? (
        <Skeleton className="h-64" />
      ) : data ? (
        <Tabs defaultValue={tab}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="you">Aguardando você ({data.waitingYou.length})</TabsTrigger>
            <TabsTrigger value="client">Aguardando o cliente ({data.waitingClient.length})</TabsTrigger>
            <TabsTrigger value="decisions">Decisões ({data.decisions.length})</TabsTrigger>
            <TabsTrigger value="system">Sistema ({data.system.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="you">
            <ConversationList
              items={data.waitingYou}
              empty="Ninguém esperando resposta sua."
              dismissLabel="Já resolvi"
              onDismiss={(c) => setPending({ c, side: "client" })}
            />
          </TabsContent>
          <TabsContent value="client">
            <ConversationList
              items={data.waitingClient}
              empty="Nenhum cliente há mais de 3 dias sem responder."
              dismissLabel="Parar de esperar"
              onDismiss={(c) => setPending({ c, side: "lumeis" })}
            />
          </TabsContent>
          <TabsContent value="decisions">
            <DecisionList items={data.decisions} onDecide={decide} />
          </TabsContent>
          <TabsContent value="system">
            {data.system.length ? (
              <ul className="space-y-2">
                {data.system.map((s) => (
                  <li key={s.key} className="flex items-start gap-2 text-sm">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    {s.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">Tudo rodando.</p>
            )}
          </TabsContent>
        </Tabs>
      ) : null}

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending?.side === "client" ? "Já resolvi" : "Parar de esperar"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {pending?.c.companyName}: {pending?.c.title}. Se chegar mensagem nova, a conversa volta para a lista.
          </p>
          <Textarea placeholder="Motivo (opcional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmDismiss}>Dispensar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function PendenciasPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <Pendencias />
    </Suspense>
  )
}
```

```tsx
// src/components/pendencias/open-items-strip.tsx
"use client"

import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { useOpenItems } from "@/hooks/use-open-items"

const ago = (h: number) => (h >= 48 ? `${Math.floor(h / 24)} dias` : `${h} h`)

/** Faixa do dashboard: os quatro contadores e as 3 conversas mais antigas esperando você. */
export function OpenItemsStrip() {
  const { data } = useOpenItems()
  if (!data) return null
  const counts = [
    { label: "Aguardando você", n: data.waitingYou.length, tab: "you", alert: data.waitingYou.some((c) => c.ageHours > 24) },
    { label: "Aguardando o cliente", n: data.waitingClient.length, tab: "client", alert: false },
    { label: "Decisões", n: data.decisions.length, tab: "decisions", alert: false },
    { label: "Sistema", n: data.system.length, tab: "system", alert: data.system.length > 0 },
  ]
  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {counts.map((c) => (
            <Link key={c.tab} href={`/pendencias?tab=${c.tab}`} className="rounded-md border p-3 transition-colors hover:bg-muted/50">
              <div className={`text-2xl font-bold ${c.alert ? "text-destructive" : ""}`}>{c.n}</div>
              <div className="text-xs text-muted-foreground">{c.label}</div>
            </Link>
          ))}
        </div>
        {data.waitingYou.slice(0, 3).map((c) => (
          <Link key={c.conversationKey} href="/pendencias" className="block truncate text-sm hover:underline">
            <b>{c.companyName}</b> · {c.title} · há {ago(c.ageHours)}
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}
```

No `dashboard/page.tsx`, importar `OpenItemsStrip` e colocá-lo logo antes de `<CopilotPanel onApplied={loadStats} />`.

No `sidebar.tsx`, importar `Inbox` de `lucide-react` e inserir `{ href: "/pendencias", label: "Pendências", icon: Inbox },` logo depois do Dashboard.

- [ ] **Step 5: Typecheck, lint e build**

Run: `npx tsc --noEmit && npx eslint src/components/pendencias src/hooks/use-open-items.ts "src/app/(dashboard)/pendencias" src/app/api/pendencias && npx next build`
Expected: sem erro nos arquivos novos. O build compila a página.

- [ ] **Step 6: Roteiro manual (dev)**

`npm run dev`, logar e conferir:

1. `/pendencias` abre as quatro abas, com contadores.
2. "Aguardando você" lista conversas reais de e-mail e WhatsApp. "Abrir" leva ao Gmail.
3. "Já resolvi" pede o motivo, a conversa some, e `conversation_dismissals` ganha a linha.
4. Decisões: um caso de domínio, "Ignorar", some. Uma sugestão de estágio mostra "Decidir no copiloto da conta".
5. O dashboard mostra a faixa acima do copiloto, e os contadores batem com as abas.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/use-open-items.ts src/components/pendencias "src/app/(dashboard)/pendencias" "src/app/(dashboard)/dashboard/page.tsx" src/components/layout/sidebar.tsx
git commit -m "feat(pendencias): página, faixa no dashboard e menu"
```

---

### Task 8: Rollout (com o Gabriel, passo a passo)

- [ ] **Step 1: PR**: `git push -u origin feat/pendencias` e `gh pr create` com resumo, verificação e `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] **Step 2: Migração 026**: área de transferência → SQL Editor do CRM. Conferência: a consulta do fim da 026 deve dar `sem_chave = 0` para gmail e whatsapp.
- [ ] **Step 3: Merge**: `! gh pr merge <n> -R gmonteiro/crmflash --merge`. Esperar o deploy.
- [ ] **Step 4: Verificar em produção**
  - `GET /api/pendencias` sem sessão → 401.
  - Com o service store, rodar `openItems` num script e conferir as conversas sem retorno contra os eventos reais.
  - O Gabriel abre `/pendencias` e o dashboard.
- [ ] **Step 5: Resumo**: rodar `/api/cron/daily-review` com `CRON_SECRET`. Se já houver revisão hoje, a revisão é pulada; conferir o HTML pelo `digest` da resposta. O e-mail só sai uma vez por dia (cursor `daily_digest`); para ver o novo formato hoje, o Gabriel decide se apaga o cursor do dia.

### Task 9: Documentação e memória

- [ ] `docs/memory.md`: entrada "Pendências e sem retorno (24/10/2026)", com as regras, a 026, as marcas de cron e o desvio do sinal da revisão diária.
- [ ] Spec: na aba Sistema, trocar "revisão diária sem linha em `daily_reviews` ontem" por "marca do cron `daily-review` com mais de 26 h". Commit no branch do spec.
- [ ] Memória `ecossistema-comercial-lead.md`.
