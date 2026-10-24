# WhatsApp leitor local — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ler o WhatsApp pessoal do Gabriel, só leitura, no PC dele, e mandar ao CRM apenas as conversas confirmadas como comerciais, como eventos diários na timeline da conta.

**Architecture:** Um coletor local (`collectors/whatsapp/`, `whatsapp-web.js`, dispositivo vinculado) baixa um diretório do CRM, casa as conversas na própria máquina e envia candidatos (só nome e número) e agregados do dia (só de conversas confirmadas) para três endpoints novos do CRM. O CRM revalida a ligação de cada conversa, grava por `recordEvent` e resolve os candidatos pela fila de identidade que já existe.

**Tech Stack:** Next 16 (route handlers), Supabase, vitest, `whatsapp-web.js` 1.34, `libphonenumber-js` (já no CRM), tsx, pm2.

**Spec:** `lumeis-lead-lifecycle/docs/superpowers/specs/2026-10-23-whatsapp-leitor-local-design.md`

## Global Constraints

- Só leitura: o código do coletor nunca chama `sendMessage`, `sendSeen`, `markRead`, `sendPresenceAvailable`, `sendStateTyping` ou `reply`.
- Nada de conversa não confirmada sai do PC. Candidato leva só `{phone, contactName}` ou `{groupId, groupName}` e ids de candidatos, nunca texto de mensagem.
- Segredos só em env: `WHATSAPP_COLLECTOR_TOKEN` (coletor) e `WHATSAPP_COLLECTOR_TOKEN_SHA256` (Vercel). Nunca no código nem no chat.
- Um evento por conversa, por dia de São Paulo (`America/Sao_Paulo`), por sentido. `sourceId = <chatKey>:<AAAA-MM-DD>`, `sourceVersion = String(messageCount)`.
- Engajamento: `whatsapp.received` → regra existente `wa.inbound` (reseta); `whatsapp.sent` → `wa.outbound` (não reseta). Não criar regra nova.
- Texto do dia ≤ 4.000 caracteres, cortando do começo. Citação da evidência ≤ 280.
- Escopo: conversas com atividade nos últimos 30 dias; backfill de 30 dias na conversa recém-confirmada.
- Painel local na porta 3011 (o Obsidian usa a 3000).
- Mensagens de código e comentários em português, no estilo do resto do repo (sem ponto e vírgula, aspas duplas em `src/lib/hub`).
- Migração aplicada à mão no SQL Editor do CRM (`mghvrbpadiawevdlxizr`), antes do deploy.

---

## File Structure

**CRM (`src/`)**

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/whatsapp/contract.ts` (novo) | Tipos do contrato coletor ↔ CRM. Sem dependência nenhuma: o coletor importa com `import type` |
| `src/lib/whatsapp/schemas.ts` (novo) | Zod dos payloads de `candidates` e `events` |
| `src/lib/hub/whatsapp-ingest.ts` (novo) | `buildDirectory`, `openCandidates`, `recordDays`: a lógica dos três endpoints, sobre a `WhatsappStore` |
| `src/lib/hub/whatsapp-ingest.test.ts` (novo) | Testes com o memory store |
| `src/lib/hub/store.ts` | + interface `WhatsappStore` |
| `src/lib/hub/memory-store.ts`, `supabase-store.ts` | Implementam `WhatsappStore` |
| `src/lib/auth/collector.ts` (novo) | `isCollectorAuthorized` (hash do token, tempo constante) |
| `src/app/api/hub/whatsapp/{directory,candidates,events}/route.ts` (novos) | Rotas finas |
| `src/lib/hub/decisions.ts` | Resolver caso de telefone e de grupo |
| `src/lib/hub/daily-review.ts`, `sync.ts` | Alerta de batimento parado no resumo |
| `supabase/migrations/025_whatsapp.sql` (novo) | `whatsapp_group_companies` |
| `scripts/whatsapp-collector-token.mjs` (novo) | Gera o token, grava no `.env` do coletor e imprime só o hash |

**Coletor (`collectors/whatsapp/`)**

| Arquivo | Responsabilidade |
|---|---|
| `package.json`, `tsconfig.json`, `.env.example`, `.gitignore`, `Dockerfile`, `ecosystem.config.cjs`, `start-hidden.vbs`, `README.md` | Pacote e operação |
| `src/day.ts` | Dia de São Paulo de um timestamp |
| `src/directory.ts` | `indexDirectory`: diretório → índices de busca |
| `src/match.ts` | `matchChat`: vinculada, candidata ou ignorada (puro) |
| `src/aggregate.ts` | `aggregateDays`: mensagens → eventos do dia (puro) |
| `src/cycle.ts` | `runCycle`: um ciclo completo sobre interfaces (testável sem WhatsApp) |
| `src/state.ts` | Estado local em `state.json` |
| `src/crm-client.ts` | HTTP para os três endpoints |
| `src/readonly.ts` | `ReadOnlyWhatsApp`: embrulha o `Client` e traduz para as interfaces do ciclo |
| `src/web.ts` | Painel local (cópia adaptada do `whatsapp-obsidian`) |
| `src/index.ts` | Liga tudo e agenda o ciclo |
| `src/*.test.ts` | Testes dos módulos puros e a guarda de só leitura |

O `tsconfig.json` e o `eslint.config.mjs` da raiz excluem `collectors/`. O `vitest.config.ts` da raiz inclui `collectors/whatsapp/src/**/*.test.ts`, porque os testes só importam módulos puros (nada de `whatsapp-web.js`), e assim `npm test` na raiz cobre tudo.

---

### Task 1: Contrato, migração 025 e `WhatsappStore`

**Files:**
- Create: `src/lib/whatsapp/contract.ts`
- Create: `supabase/migrations/025_whatsapp.sql`
- Modify: `src/lib/hub/store.ts` (fim do arquivo)
- Modify: `src/lib/hub/memory-store.ts`
- Modify: `src/lib/hub/supabase-store.ts`
- Test: `src/lib/hub/whatsapp-ingest.test.ts` (criado na Task 2; aqui só o typecheck)

**Interfaces:**
- Produces: tipos `WaDirectory`, `WaCandidate`, `WaDayEvent`, `WaEventsResult`, `WaCandidatesResult`; interface `WhatsappStore` com `whatsappDirectorySource()`, `whatsappGroupCompany(groupId)`, `linkWhatsappGroup(groupId, groupName, companyId, ignored)`.

- [ ] **Step 1: Criar o contrato**

```ts
// src/lib/whatsapp/contract.ts
// O contrato entre o coletor local de WhatsApp e o CRM. Sem import nenhum:
// o coletor (collectors/whatsapp) importa isto com `import type`.
//
// Regra do contrato: candidato leva só nome e número (ou nome do grupo), nunca
// mensagem. Mensagem só vai em WaDayEvent, e só de conversa já confirmada.

/** Chave estável da conversa: "p:+5521987654321" (1:1) ou "g:<id>@g.us" (grupo). */
export type WaChatKey = string

export interface WaDirectory {
  generatedAt: string
  /** Pessoas com nome e sobrenome. nameKey = normalizePersonName(nome completo). */
  people: { id: string; nameKey: string; companyId: string | null }[]
  /** Empresas do funil (com estágio). nameKey = companyNameKey(nome). */
  companies: { id: string; nameKey: string }[]
  /** Telefones já decididos. digits = as variantes sem "+" (com e sem o nono dígito). */
  phones: { digits: string[]; personId: string | null; ignored: boolean }[]
  groups: { groupId: string; companyId: string | null; ignored: boolean }[]
}

export type WaCandidate =
  | { type: "direct"; phone: string; contactName: string; personIds: string[] }
  | { type: "group"; groupId: string; groupName: string; companyIds: string[]; matchedBy: "nome" | "participante" }

export interface WaDayEvent {
  chatKey: WaChatKey
  chat: { type: "direct"; phone: string } | { type: "group"; groupId: string }
  chatName: string
  /** AAAA-MM-DD em São Paulo. */
  day: string
  direction: "received" | "sent"
  messageCount: number
  /** ISO da última mensagem deste sentido no dia. */
  lastAt: string
  /** "HH:MM Nome: texto", linhas em ordem, ≤ 4000 caracteres. */
  text: string
  lastMessage: { id: string; quote: string }
  /** Telefones (E.164) de quem falou deste lado no dia. */
  speakerPhones: string[]
}

export interface WaCandidatesResult {
  opened: number
  skipped: number
}

export interface WaEventsResult {
  recorded: number
  rejected: { chatKey: string; day: string; reason: string }[]
}
```

- [ ] **Step 2: Escrever a migração 025**

```sql
-- 025_whatsapp.sql
--
-- whatsapp_group_companies: grupo do WhatsApp → empresa do CRM. Ligado uma vez
-- pela fila (caso grupo_sem_empresa), toda conversa do grupo desce para a
-- empresa. company_id null + ignored = grupo que não é comercial.
--
-- Telefone não precisa de tabela: vira person_identities(kind='phone'), que a
-- 020 já aceita.
--
-- RODAR INTEIRA, DE UMA VEZ, NO SUPABASE SQL EDITOR, ANTES DO DEPLOY.

begin;

create table if not exists whatsapp_group_companies (
  workspace_id uuid not null default default_workspace() references workspaces (id) on delete cascade,
  group_id text not null,
  group_name text,
  company_id uuid references companies (id) on delete cascade,
  ignored boolean not null default false,
  source text not null default 'review',
  created_at timestamptz not null default now(),
  primary key (workspace_id, group_id),
  check (ignored or company_id is not null)
);
create index if not exists idx_whatsapp_group_companies_company on whatsapp_group_companies (company_id);

do $rls$
begin
  if not exists (select 1 from pg_policies where tablename = 'whatsapp_group_companies') then
    alter table whatsapp_group_companies enable row level security;
    create policy whatsapp_group_companies_ws_select on whatsapp_group_companies for select using (workspace_id = current_workspace());
    create policy whatsapp_group_companies_ws_insert on whatsapp_group_companies for insert with check (workspace_id = current_workspace());
    create policy whatsapp_group_companies_ws_update on whatsapp_group_companies for update using (workspace_id = current_workspace()) with check (workspace_id = current_workspace());
  end if;
end
$rls$;

commit;

-- Conferência: deve dar 1.
-- select count(*) from information_schema.tables where table_name = 'whatsapp_group_companies';
```

- [ ] **Step 3: Adicionar `WhatsappStore` ao fim de `store.ts`**

```ts
// --- WhatsApp (025) -------------------------------------------------------

/** O cru que o diretório do coletor precisa; a normalização é do whatsapp-ingest. */
export interface WhatsappDirectorySource {
  people: { id: string; fullName: string; companyId: string | null }[]
  /** Só as do funil (com estágio). */
  companies: { id: string; name: string }[]
  phones: { valueNorm: string; personId: string | null; ignored: boolean }[]
  groups: { groupId: string; companyId: string | null; ignored: boolean }[]
}

export interface WhatsappStore {
  whatsappDirectorySource(): Promise<WhatsappDirectorySource>
  whatsappGroupCompany(groupId: string): Promise<{ companyId: string | null; ignored: boolean } | null>
  /** Grava (ou troca) a ligação. companyId null + ignored = grupo não comercial. */
  linkWhatsappGroup(groupId: string, groupName: string | null, companyId: string | null, ignored: boolean): Promise<void>
}
```

- [ ] **Step 4: Implementar no memory store**

Em `memory-store.ts`, acrescentar `WhatsappStore, WhatsappDirectorySource` ao import de `./store`, trocar a declaração da classe para `export class MemoryHubStore implements HubStore, DailyReviewStore, WhatsappStore {` e inserir antes de `async tappProjectCompany(`:

```ts
  // --- WhatsApp ---
  waGroups = new Map<string, { companyId: string | null; ignored: boolean; name: string | null }>()
  /** Empresas do funil para o diretório (nos testes, o que o teste disser). */
  funnelCompanyIds = new Set<string>()

  async whatsappDirectorySource(): Promise<WhatsappDirectorySource> {
    return {
      people: [...this.people.values()].map((p) => ({ id: p.id, fullName: p.fullName, companyId: p.companyId })),
      companies: [...this.companies.values()]
        .filter((c) => this.funnelCompanyIds.has(c.id))
        .map((c) => ({ id: c.id, name: c.name })),
      phones: [...this.identities.values()]
        .filter((i) => i.kind === "phone")
        .map((i) => ({ valueNorm: i.valueNorm, personId: i.personId, ignored: i.ignored })),
      groups: [...this.waGroups.entries()].map(([groupId, g]) => ({ groupId, companyId: g.companyId, ignored: g.ignored })),
    }
  }

  async whatsappGroupCompany(groupId: string) {
    const g = this.waGroups.get(groupId)
    return g ? { companyId: g.companyId, ignored: g.ignored } : null
  }

  async linkWhatsappGroup(groupId: string, groupName: string | null, companyId: string | null, ignored: boolean) {
    this.waGroups.set(groupId, { companyId, ignored, name: groupName })
  }

```

Antes de escrever, conferir em `memory-store.ts` os nomes reais dos mapas de pessoas e empresas (`this.people`, `this.companies`) e os campos (`fullName`, `companyId`, `name`). Se forem outros, usar os reais.

- [ ] **Step 5: Implementar no Supabase store**

Em `supabase-store.ts`, acrescentar ao import de `./store`, declarar `implements HubStore, DailyReviewStore, WhatsappStore` e inserir antes de `async tappProjectCompany(`:

```ts
  // --- WhatsApp (025) -------------------------------------------------------

  /** O PostgREST corta em 1000 linhas: pagina até acabar. */
  private async allRows<T>(label: string, page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
    const out: T[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await page(from, from + 999)
      if (error) fail(label, error as { message: string })
      out.push(...(data ?? []))
      if (!data || data.length < 1000) return out
    }
  }

  async whatsappDirectorySource(): Promise<WhatsappDirectorySource> {
    const [people, companies, phones, groups] = await Promise.all([
      this.allRows<Row>("wa people", (a, b) =>
        this.db.from("people").select("id, first_name, last_name, company_id").eq("workspace_id", this.workspaceId).range(a, b)
      ),
      this.allRows<Row>("wa companies", (a, b) =>
        this.db
          .from("companies")
          .select("id, name, kanban_columns!inner(id)")
          .eq("workspace_id", this.workspaceId)
          .range(a, b)
      ),
      this.allRows<Row>("wa phones", (a, b) =>
        this.db
          .from("person_identities")
          .select("value_norm, person_id, ignored")
          .eq("workspace_id", this.workspaceId)
          .eq("kind", "phone")
          .range(a, b)
      ),
      this.allRows<Row>("wa groups", (a, b) =>
        this.db.from("whatsapp_group_companies").select("group_id, company_id, ignored").eq("workspace_id", this.workspaceId).range(a, b)
      ),
    ])
    return {
      people: people.map((p) => ({
        id: p.id as string,
        fullName: `${(p.first_name as string) ?? ""} ${(p.last_name as string) ?? ""}`.trim(),
        companyId: (p.company_id as string) ?? null,
      })),
      companies: companies.map((c) => ({ id: c.id as string, name: c.name as string })),
      phones: phones.map((i) => ({
        valueNorm: i.value_norm as string,
        personId: (i.person_id as string) ?? null,
        ignored: !!i.ignored,
      })),
      groups: groups.map((g) => ({
        groupId: g.group_id as string,
        companyId: (g.company_id as string) ?? null,
        ignored: !!g.ignored,
      })),
    }
  }

  async whatsappGroupCompany(groupId: string) {
    const { data, error } = await this.db
      .from("whatsapp_group_companies")
      .select("company_id, ignored")
      .eq("workspace_id", this.workspaceId)
      .eq("group_id", groupId)
      .maybeSingle()
    if (error) fail("whatsappGroupCompany", error)
    return data ? { companyId: (data.company_id as string) ?? null, ignored: !!data.ignored } : null
  }

  async linkWhatsappGroup(groupId: string, groupName: string | null, companyId: string | null, ignored: boolean) {
    const { error } = await this.db
      .from("whatsapp_group_companies")
      .upsert(this.ws({ group_id: groupId, group_name: groupName, company_id: companyId, ignored, source: "review" }), {
        onConflict: "workspace_id,group_id",
      })
    if (error) fail("linkWhatsappGroup", error)
  }

```

Conferir a assinatura de `fail` e o tipo `Row` no topo do arquivo e ajustar o cast se precisar. O nome `kanban_columns!inner` é o mesmo que `activeCompanies` já usa.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add src/lib/whatsapp/contract.ts supabase/migrations/025_whatsapp.sql src/lib/hub/store.ts src/lib/hub/memory-store.ts src/lib/hub/supabase-store.ts
git commit -m "feat(whatsapp): contrato do coletor, migração 025 e WhatsappStore"
```

---

### Task 2: Lógica dos endpoints (`whatsapp-ingest.ts`)

**Files:**
- Create: `src/lib/hub/whatsapp-ingest.ts`
- Create: `src/lib/whatsapp/schemas.ts`
- Test: `src/lib/hub/whatsapp-ingest.test.ts`

**Interfaces:**
- Consumes: `WhatsappStore` e os tipos do contrato (Task 1); `recordEvent`; `reviewDedupKey`; `normalizePhone`, `phoneVariants`, `normalizePersonName`, `companyNameKey`.
- Produces:
  - `buildDirectory(store: WhatsappStore): Promise<WaDirectory>`
  - `openCandidates(store: HubStore & WhatsappStore, list: WaCandidate[]): Promise<WaCandidatesResult>`
  - `recordDays(store: HubStore & WhatsappStore, list: WaDayEvent[]): Promise<WaEventsResult>`
  - `WA_REVIEW_REASON_CONTACT = "whatsapp_contato"`, `WA_REVIEW_REASON_GROUP = "grupo_sem_empresa"`
  - `waCandidateSchema`, `waDayEventSchema` (zod)

- [ ] **Step 1: Escrever os testes**

```ts
// src/lib/hub/whatsapp-ingest.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import { MemoryHubStore } from "./memory-store"
import { buildDirectory, openCandidates, recordDays } from "./whatsapp-ingest"
import type { WaDayEvent } from "@/lib/whatsapp/contract"

const ACME = "co-acme"
let store: MemoryHubStore
let joaoId: string

beforeEach(async () => {
  store = new MemoryHubStore()
  store.addCompany({ id: ACME, name: "Acme Ltda" })
  store.funnelCompanyIds.add(ACME)
  store.addCompany({ id: "co-fora", name: "Fora do Funil" })
  const joao = await store.createPerson({ firstName: "João", lastName: "Silva", companyId: ACME, currentCompany: "Acme", email: null })
  joaoId = joao.id
  await store.createPerson({ firstName: "Ana", lastName: "—", companyId: ACME, currentCompany: "Acme", email: null })
})

const day = (over: Partial<WaDayEvent> = {}): WaDayEvent => ({
  chatKey: "p:+5521987654321",
  chat: { type: "direct", phone: "+5521987654321" },
  chatName: "João Silva",
  day: "2026-10-22",
  direction: "received",
  messageCount: 2,
  lastAt: "2026-10-22T17:40:00.000Z",
  text: "14:30 João Silva: segue o export\n14:40 João Silva: falamos quinta?",
  lastMessage: { id: "wamid-2", quote: "falamos quinta?" },
  speakerPhones: ["+5521987654321"],
  ...over,
})

const confirmPhone = () =>
  store.addIdentity({ personId: joaoId, kind: "phone", valueNorm: "+5521987654321", source: "review", confidence: "confirmed" })

describe("diretório", () => {
  it("leva pessoas com nome e sobrenome, empresas do funil, telefones com variantes e grupos", async () => {
    await confirmPhone()
    await store.linkWhatsappGroup("120@g.us", "Lumeis <> Acme", ACME, false)
    const d = await buildDirectory(store)
    expect(d.people).toEqual([{ id: joaoId, nameKey: "joao silva", companyId: ACME }])
    expect(d.companies).toEqual([{ id: ACME, nameKey: "acme" }])
    expect(d.phones).toEqual([{ digits: ["5521987654321", "552187654321"], personId: joaoId, ignored: false }])
    expect(d.groups).toEqual([{ groupId: "120@g.us", companyId: ACME, ignored: false }])
  })
})

describe("candidatos", () => {
  it("abre um caso por telefone, só com nome e número, e não duplica", async () => {
    const c = { type: "direct" as const, phone: "+5521987654321", contactName: "João Silva", personIds: [joaoId] }
    expect(await openCandidates(store, [c, c])).toEqual({ opened: 1, skipped: 1 })
    const [r] = [...store.reviews.values()]
    expect(r.reason).toBe("whatsapp_contato")
    expect(r.observed).toEqual({ source: "whatsapp", phone: "+5521987654321", name: "João Silva" })
    expect(r.candidates.map((x) => x.personId)).toEqual([joaoId])
  })

  it("grupo vira grupo_sem_empresa; id de candidato que não existe é descartado", async () => {
    await openCandidates(store, [
      { type: "group", groupId: "120@g.us", groupName: "Lumeis <> Acme", companyIds: [ACME, "co-inventada"], matchedBy: "nome" },
    ])
    const [r] = [...store.reviews.values()]
    expect(r.reason).toBe("grupo_sem_empresa")
    expect(r.observed).toEqual({ source: "whatsapp", group_id: "120@g.us", group_name: "Lumeis <> Acme" })
    expect(r.candidates.map((x) => x.companyId)).toEqual([ACME])
  })

  it("telefone já decidido não abre caso", async () => {
    await confirmPhone()
    const r = await openCandidates(store, [{ type: "direct", phone: "+5521987654321", contactName: "João Silva", personIds: [] }])
    expect(r).toEqual({ opened: 0, skipped: 1 })
  })
})

describe("eventos do dia", () => {
  it("conversa não confirmada é recusada e nada é gravado", async () => {
    const r = await recordDays(store, [day()])
    expect(r).toEqual({ recorded: 0, rejected: [{ chatKey: "p:+5521987654321", day: "2026-10-22", reason: "conversa_nao_confirmada" }] })
    expect(store.events.size).toBe(0)
  })

  it("cliente escreveu: whatsapp.received, reseta na hora da última mensagem dele", async () => {
    await confirmPhone()
    expect((await recordDays(store, [day()])).recorded).toBe(1)
    const [ev] = [...store.events.values()]
    expect(ev).toMatchObject({
      source: "whatsapp",
      sourceId: "p:+5521987654321:2026-10-22",
      sourceVersion: "2",
      kind: "whatsapp.received",
      companyId: ACME,
      direction: "inbound",
      clientEngaged: true,
      engagementRule: "wa.inbound",
      title: "WhatsApp: João Silva",
    })
    expect(ev.evidence[0]).toMatchObject({ kind: "whatsapp", ref: "wamid-2", quote: "falamos quinta?", locator: "João Silva às 14:40" })
    expect(store.companies.get(ACME)!.lastClientEventAt).toBe("2026-10-22T17:40:00.000Z")
  })

  it("IDEMPOTÊNCIA: o mesmo agregado duas vezes, um evento; com mais mensagens, atualiza", async () => {
    await confirmPhone()
    await recordDays(store, [day()])
    await recordDays(store, [day()])
    expect(store.events.size).toBe(1)
    await recordDays(store, [day({ messageCount: 3, text: "…\n15:00 João Silva: e o preço?" })])
    expect(store.events.size).toBe(1)
    expect([...store.events.values()][0].sourceVersion).toBe("3")
  })

  it("você escreveu: whatsapp.sent, outro evento, não reseta", async () => {
    await confirmPhone()
    await recordDays(store, [day({ direction: "sent", lastMessage: { id: "wamid-9", quote: "fechado" }, speakerPhones: [] })])
    const [ev] = [...store.events.values()]
    expect(ev).toMatchObject({ kind: "whatsapp.sent", direction: "outbound", clientEngaged: false, title: "WhatsApp enviado: João Silva" })
    expect(store.companies.get(ACME)!.lastClientEventAt).toBeUndefined()
  })

  it("grupo ligado: vai para a empresa do grupo; grupo ignorado é recusado", async () => {
    await store.linkWhatsappGroup("120@g.us", "Lumeis <> Acme", ACME, false)
    await store.linkWhatsappGroup("999@g.us", "Família", null, true)
    const g = (id: string) => day({ chatKey: `g:${id}`, chat: { type: "group", groupId: id }, chatName: "Lumeis <> Acme", speakerPhones: [] })
    const r = await recordDays(store, [g("120@g.us"), g("999@g.us")])
    expect(r.recorded).toBe(1)
    expect(r.rejected.map((x) => x.reason)).toEqual(["grupo_ignorado"])
    expect([...store.events.values()][0].companyId).toBe(ACME)
  })
})
```

Antes de rodar, conferir os helpers reais do memory store (`addCompany`, `createPerson`, `companies`, `events`, `reviews`) usados nos testes de `gmail-ingest.test.ts`. Se `createPerson` exigir campos a mais, completar.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/hub/whatsapp-ingest.test.ts`
Expected: FAIL, `Cannot find module './whatsapp-ingest'`.

- [ ] **Step 3: Escrever os schemas**

```ts
// src/lib/whatsapp/schemas.ts
import { z } from "zod"

// O candidato NÃO tem campo de mensagem: `.strict()` recusa qualquer coisa a mais.
export const waCandidateSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("direct"),
      phone: z.string().min(8).max(20),
      contactName: z.string().trim().min(1).max(120),
      personIds: z.array(z.string().uuid()).max(10),
    })
    .strict(),
  z
    .object({
      type: z.literal("group"),
      groupId: z.string().regex(/@g\.us$/),
      groupName: z.string().trim().min(1).max(200),
      companyIds: z.array(z.string().uuid()).max(10),
      matchedBy: z.enum(["nome", "participante"]),
    })
    .strict(),
])

export const waDayEventSchema = z.object({
  chatKey: z.string().min(3).max(80),
  chat: z.discriminatedUnion("type", [
    z.object({ type: z.literal("direct"), phone: z.string().min(8).max(20) }),
    z.object({ type: z.literal("group"), groupId: z.string().regex(/@g\.us$/) }),
  ]),
  chatName: z.string().max(200),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  direction: z.enum(["received", "sent"]),
  messageCount: z.number().int().min(1).max(10_000),
  lastAt: z.string().datetime(),
  text: z.string().max(4_000),
  lastMessage: z.object({ id: z.string().min(1).max(200), quote: z.string().max(280) }),
  speakerPhones: z.array(z.string().max(20)).max(50),
})

export const waCandidatesBody = z.object({ candidates: z.array(waCandidateSchema).max(200) })
export const waEventsBody = z.object({ events: z.array(waDayEventSchema).max(50) })
```

No teste de grupo com `"co-inventada"`, o id não é uuid. O teste chama `openCandidates` direto, sem passar pelo schema, então isso é intencional: a função também tem de descartar id que não existe.

- [ ] **Step 4: Implementar `whatsapp-ingest.ts`**

```ts
// src/lib/hub/whatsapp-ingest.ts
import { recordEvent } from "@/lib/events/record"
import type { ParticipantRef } from "@/lib/events/types"
import { companyNameKey, normalizePersonName, normalizePhone, phoneVariants, personNameTokens } from "@/lib/identity/normalize"
import { reviewDedupKey } from "@/lib/identity/resolve"
import type { WaCandidate, WaCandidatesResult, WaDayEvent, WaDirectory, WaEventsResult } from "@/lib/whatsapp/contract"
import type { HubStore, ReviewCandidate, WhatsappStore } from "./store"

// WhatsApp → CRM, do lado do CRM. O coletor roda no PC do Gabriel e já casou
// as conversas lá (nada pessoal sai da máquina). Aqui:
//
//   - buildDirectory: o que o coletor precisa para casar;
//   - openCandidates: caso na fila com SÓ nome e número (ou nome do grupo);
//   - recordDays: o agregado do dia, revalidado — o CRM não confia no coletor
//     para dizer a empresa; ele mesmo resolve pela identidade ou pelo grupo.

export const WA_REVIEW_REASON_CONTACT = "whatsapp_contato"
export const WA_REVIEW_REASON_GROUP = "grupo_sem_empresa"

const digits = (e164: string) => e164.replace(/\D/g, "")

export async function buildDirectory(store: WhatsappStore): Promise<WaDirectory> {
  const src = await store.whatsappDirectorySource()
  return {
    generatedAt: new Date().toISOString(),
    people: src.people
      .filter((p) => personNameTokens(p.fullName.replace(/—/g, " ")).length >= 2)
      .map((p) => ({ id: p.id, nameKey: normalizePersonName(p.fullName)!, companyId: p.companyId })),
    companies: src.companies
      .map((c) => ({ id: c.id, nameKey: companyNameKey(c.name) }))
      .filter((c): c is { id: string; nameKey: string } => !!c.nameKey && c.nameKey.length >= 4),
    phones: src.phones.map((p) => ({ digits: phoneVariants(p.valueNorm).map(digits), personId: p.personId, ignored: p.ignored })),
    groups: src.groups,
  }
}

export async function openCandidates(store: HubStore & WhatsappStore, list: WaCandidate[]): Promise<WaCandidatesResult> {
  let opened = 0
  let skipped = 0
  const seen = new Set<string>()
  for (const c of list) {
    if (c.type === "direct") {
      const phone = normalizePhone(c.phone)
      if (!phone || seen.has(`p:${phone}`) || (await store.findIdentity("phone", phone))) {
        skipped++
        continue
      }
      seen.add(`p:${phone}`)
      const candidates: ReviewCandidate[] = []
      for (const id of c.personIds) {
        const p = await store.getPerson(id)
        if (p) candidates.push({ personId: p.id, label: p.fullName, score: 0.7, reasons: ["nome salvo no celular igual ao do CRM"] })
      }
      await store.openReview({
        dedupKey: reviewDedupKey("phone", phone),
        companyId: null,
        reason: WA_REVIEW_REASON_CONTACT,
        observed: { source: "whatsapp", phone, name: c.contactName },
        candidates,
      })
      opened++
      continue
    }

    if (seen.has(`g:${c.groupId}`) || (await store.whatsappGroupCompany(c.groupId))) {
      skipped++
      continue
    }
    seen.add(`g:${c.groupId}`)
    const candidates: ReviewCandidate[] = []
    for (const id of c.companyIds) {
      const co = await store.getCompany(id)
      if (!co) continue
      candidates.push({
        companyId: co.id,
        label: co.name,
        score: c.matchedBy === "nome" ? 0.8 : 0.6,
        reasons: [c.matchedBy === "nome" ? "o nome do grupo contém o nome da empresa" : "um participante é contato confirmado da empresa"],
      })
    }
    await store.openReview({
      dedupKey: reviewDedupKey("wa_group", c.groupId),
      companyId: candidates[0]?.companyId ?? null,
      reason: WA_REVIEW_REASON_GROUP,
      observed: { source: "whatsapp", group_id: c.groupId, group_name: c.groupName },
      candidates,
    })
    opened++
  }
  return { opened, skipped }
}
```

O teste "abre um caso por telefone… e não duplica" espera `{opened: 1, skipped: 1}` para a mesma entrada duas vezes, e o `seen` garante isso. Fora do mesmo lote, o `openReview` deduplica pelo `dedupKey`; nesse caso `opened` conta a chamada, o que é aceitável para um contador de diagnóstico.

Depois, no mesmo arquivo:

```ts
function hhmmSaoPaulo(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(
    new Date(iso)
  )
}

type ChatTarget = { companyId: string; personId: string | null } | { rejected: string }

async function resolveChat(store: HubStore & WhatsappStore, e: WaDayEvent): Promise<ChatTarget> {
  if (e.chat.type === "group") {
    const g = await store.whatsappGroupCompany(e.chat.groupId)
    if (!g) return { rejected: "conversa_nao_confirmada" }
    if (g.ignored || !g.companyId) return { rejected: "grupo_ignorado" }
    return { companyId: g.companyId, personId: null }
  }
  const phone = normalizePhone(e.chat.phone)
  if (!phone) return { rejected: "telefone_invalido" }
  for (const v of phoneVariants(phone)) {
    const id = await store.findIdentity("phone", v)
    if (!id) continue
    if (id.ignored || !id.personId) return { rejected: "contato_ignorado" }
    const person = await store.getPerson(id.personId)
    if (!person?.companyId) return { rejected: "pessoa_sem_empresa" }
    return { companyId: person.companyId, personId: person.id }
  }
  return { rejected: "conversa_nao_confirmada" }
}

export async function recordDays(store: HubStore & WhatsappStore, list: WaDayEvent[]): Promise<WaEventsResult> {
  const result: WaEventsResult = { recorded: 0, rejected: [] }
  for (const e of list) {
    const target = await resolveChat(store, e)
    if ("rejected" in target) {
      result.rejected.push({ chatKey: e.chatKey, day: e.day, reason: target.rejected })
      continue
    }

    // Quem falou deste lado, entre as pessoas já confirmadas.
    const participants: ParticipantRef[] = []
    if (e.direction === "received") {
      for (const raw of e.speakerPhones) {
        const phone = normalizePhone(raw)
        const id = phone ? await store.findIdentity("phone", phone) : null
        if (id?.personId && !id.ignored) participants.push({ personId: id.personId, role: "from" })
      }
      if (!participants.length && target.personId) participants.push({ personId: target.personId, role: "from" })
    }

    const received = e.direction === "received"
    await recordEvent(store, {
      source: "whatsapp",
      sourceId: `${e.chatKey}:${e.day}`,
      sourceVersion: String(e.messageCount),
      kind: received ? "whatsapp.received" : "whatsapp.sent",
      companyId: target.companyId,
      personId: target.personId,
      occurredAt: e.lastAt,
      direction: received ? "inbound" : "outbound",
      title: received ? `WhatsApp: ${e.chatName}` : `WhatsApp enviado: ${e.chatName}`,
      description: e.text || null,
      evidence: [
        {
          kind: "whatsapp",
          ref: e.lastMessage.id,
          quote: e.lastMessage.quote.slice(0, 280) || undefined,
          locator: `${e.chatName} às ${hhmmSaoPaulo(e.lastAt)}`,
        },
      ],
      participants,
    })
    result.recorded++
  }
  return result
}
```

- [ ] **Step 5: Rodar os testes**

Run: `npx vitest run src/lib/hub/whatsapp-ingest.test.ts`
Expected: PASS (9 testes).

`"Ana —"` (sobrenome vazio vira travessão no CRM) dá 1 token em `personNameTokens` e sai do diretório, como o teste espera.

- [ ] **Step 6: Commit**

```bash
git add src/lib/hub/whatsapp-ingest.ts src/lib/hub/whatsapp-ingest.test.ts src/lib/whatsapp/schemas.ts
git commit -m "feat(whatsapp): diretório, candidatos e eventos do dia no CRM"
```

---

### Task 3: Autenticação do coletor e as três rotas

**Files:**
- Create: `src/lib/auth/collector.ts`
- Create: `src/lib/auth/collector.test.ts`
- Create: `src/app/api/hub/whatsapp/directory/route.ts`
- Create: `src/app/api/hub/whatsapp/candidates/route.ts`
- Create: `src/app/api/hub/whatsapp/events/route.ts`
- Create: `scripts/whatsapp-collector-token.mjs`

**Interfaces:**
- Consumes: `buildDirectory`, `openCandidates`, `recordDays`, `waCandidatesBody`, `waEventsBody` (Task 2); `SupabaseHubStore.fromEnv()`.
- Produces: `isCollectorAuthorized(request: Request): boolean`; rotas `GET /api/hub/whatsapp/directory`, `POST /api/hub/whatsapp/candidates`, `POST /api/hub/whatsapp/events`. O POST de eventos grava o cursor `("whatsapp", <ISO>, "heartbeat")`, inclusive com lista vazia.

- [ ] **Step 1: Teste da autenticação**

```ts
// src/lib/auth/collector.test.ts
import { describe, it, expect, afterEach } from "vitest"
import { createHash } from "crypto"
import { isCollectorAuthorized } from "./collector"

const req = (h?: string) => new Request("https://x/api", { headers: h ? { authorization: h } : {} })
afterEach(() => {
  delete process.env.WHATSAPP_COLLECTOR_TOKEN_SHA256
})

describe("token do coletor", () => {
  it("sem hash configurado, nada passa", () => {
    expect(isCollectorAuthorized(req("Bearer abc"))).toBe(false)
  })
  it("compara o hash do token, não o token", () => {
    process.env.WHATSAPP_COLLECTOR_TOKEN_SHA256 = createHash("sha256").update("segredo").digest("hex")
    expect(isCollectorAuthorized(req("Bearer segredo"))).toBe(true)
    expect(isCollectorAuthorized(req("Bearer outro"))).toBe(false)
    expect(isCollectorAuthorized(req())).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/auth/collector.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
// src/lib/auth/collector.ts
import { createHash, timingSafeEqual } from "crypto"

/**
 * O coletor local de WhatsApp manda `Authorization: Bearer <token>`. O CRM
 * guarda só o SHA-256 (WHATSAPP_COLLECTOR_TOKEN_SHA256): vazar a env da Vercel
 * não entrega o token. Sem o hash configurado, nada passa.
 */
export function isCollectorAuthorized(request: Request): boolean {
  const expected = process.env.WHATSAPP_COLLECTOR_TOKEN_SHA256?.trim().toLowerCase()
  if (!expected) return false
  const header = request.headers.get("authorization") ?? ""
  if (!header.startsWith("Bearer ")) return false
  const got = createHash("sha256").update(header.slice(7)).digest("hex")
  const a = Buffer.from(got)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
```

- [ ] **Step 4: As rotas**

```ts
// src/app/api/hub/whatsapp/directory/route.ts
import { NextResponse } from "next/server"
import { isCollectorAuthorized } from "@/lib/auth/collector"
import { SupabaseHubStore } from "@/lib/hub/supabase-store"
import { buildDirectory } from "@/lib/hub/whatsapp-ingest"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  if (!isCollectorAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    return NextResponse.json(await buildDirectory(await SupabaseHubStore.fromEnv()))
  } catch (e) {
    console.error("[hub/whatsapp/directory]", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
```

```ts
// src/app/api/hub/whatsapp/candidates/route.ts
import { NextResponse } from "next/server"
import { isCollectorAuthorized } from "@/lib/auth/collector"
import { SupabaseHubStore } from "@/lib/hub/supabase-store"
import { openCandidates } from "@/lib/hub/whatsapp-ingest"
import { waCandidatesBody } from "@/lib/whatsapp/schemas"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  if (!isCollectorAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const parsed = waCandidatesBody.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 })
  try {
    return NextResponse.json(await openCandidates(await SupabaseHubStore.fromEnv(), parsed.data.candidates))
  } catch (e) {
    console.error("[hub/whatsapp/candidates]", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
```

```ts
// src/app/api/hub/whatsapp/events/route.ts
import { NextResponse } from "next/server"
import { isCollectorAuthorized } from "@/lib/auth/collector"
import { SupabaseHubStore } from "@/lib/hub/supabase-store"
import { recordDays } from "@/lib/hub/whatsapp-ingest"
import { waEventsBody } from "@/lib/whatsapp/schemas"

export const maxDuration = 60
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  if (!isCollectorAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const parsed = waEventsBody.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 })
  try {
    const store = await SupabaseHubStore.fromEnv()
    const result = await recordDays(store, parsed.data.events)
    // Batimento: o resumo diário avisa se o coletor sumir por mais de 24 h.
    await store.setCursor("whatsapp", new Date().toISOString(), "heartbeat")
    return NextResponse.json(result)
  } catch (e) {
    console.error("[hub/whatsapp/events]", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
```

Conferir se `src/proxy.ts` (ou `middleware.ts`) exige sessão em `/api/*`. Se exigir, liberar `/api/hub/whatsapp/` do mesmo jeito que `/api/cron/` e `/api/integration/` são liberados lá.

- [ ] **Step 5: Script do token**

```js
// scripts/whatsapp-collector-token.mjs
// Gera o token do coletor de WhatsApp, grava em collectors/whatsapp/.env
// (WHATSAPP_COLLECTOR_TOKEN) e imprime SÓ o SHA-256, que vai para a Vercel
// como WHATSAPP_COLLECTOR_TOKEN_SHA256. O token em claro nunca aparece na tela.
import { randomBytes, createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const envPath = fileURLToPath(new URL("../collectors/whatsapp/.env", import.meta.url))
const token = randomBytes(32).toString("base64url")
const sha = createHash("sha256").update(token).digest("hex")

let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : ""
env = env.replace(/^WHATSAPP_COLLECTOR_TOKEN=.*\r?\n?/m, "")
if (env && !env.endsWith("\n")) env += "\n"
env += `WHATSAPP_COLLECTOR_TOKEN=${token}\n`
writeFileSync(envPath, env)

console.log(`token gravado em ${envPath}`)
console.log(`WHATSAPP_COLLECTOR_TOKEN_SHA256=${sha}`)
```

- [ ] **Step 6: Rodar testes e typecheck**

Run: `npx vitest run src/lib/auth/collector.test.ts && npx tsc --noEmit`
Expected: PASS e sem erros.

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/collector.ts src/lib/auth/collector.test.ts src/app/api/hub/whatsapp scripts/whatsapp-collector-token.mjs
git commit -m "feat(whatsapp): rotas do coletor com token por hash"
```

---

### Task 4: Resolver caso de telefone e de grupo

**Files:**
- Modify: `src/lib/hub/decisions.ts` (`ReviewObserved` e `resolveReview`)
- Modify: `src/lib/mcp/tools/hub/identity-reviews.ts` (só as descrições)
- Test: `src/lib/hub/decisions.test.ts`

**Interfaces:**
- Consumes: os `observed` gravados pela Task 2: `{source:"whatsapp", phone, name}` e `{source:"whatsapp", group_id, group_name}`.
- Produces: `link_person` com `phone` → `person_identities(kind='phone', confidence='confirmed')`; `ignore` com `phone` → identidade ignorada; `link_company` / `create_company` / `ignore` com `group_id` → `whatsapp_group_companies`.

- [ ] **Step 1: Testes**

Acrescentar ao fim de `decisions.test.ts`:

```ts
describe("resolveReview: WhatsApp", () => {
  const contato = {
    id: "rev-wa",
    reason: "whatsapp_contato",
    status: "open",
    company_id: null,
    observed: { source: "whatsapp", phone: "+5521987654321", name: "João Silva" },
  }
  const grupo = {
    id: "rev-g",
    reason: "grupo_sem_empresa",
    status: "open",
    company_id: null,
    observed: { source: "whatsapp", group_id: "120@g.us", group_name: "Lumeis <> Acme" },
  }

  it("ligar o contato grava o telefone como identidade confirmada", async () => {
    const { resolveReview } = await import("./decisions")
    const { client, calls } = fakeSupabase({ identity_reviews: [contato] })
    const r = await resolveReview(client, CTX, "rev-wa", { type: "link_person", personId: "p-1" })
    expect(r.ok).toBe(true)
    expect(calls.find((c) => c.table === "person_identities")!.payload).toMatchObject({
      person_id: "p-1",
      ignored: false,
      kind: "phone",
      value_norm: "+5521987654321",
      confidence: "confirmed",
    })
  })

  it("ignorar o contato grava o telefone como ignorado", async () => {
    const { resolveReview } = await import("./decisions")
    const { client, calls } = fakeSupabase({ identity_reviews: [contato] })
    await resolveReview(client, CTX, "rev-wa", { type: "ignore" })
    expect(calls.find((c) => c.table === "person_identities")!.payload).toMatchObject({ person_id: null, ignored: true, kind: "phone" })
  })

  it("ligar o grupo grava whatsapp_group_companies; ignorar grava ignored", async () => {
    const { resolveReview } = await import("./decisions")
    let f = fakeSupabase({ identity_reviews: [grupo] })
    await resolveReview(f.client, CTX, "rev-g", { type: "link_company", companyId: "co-1" })
    expect(f.calls.find((c) => c.table === "whatsapp_group_companies")!.payload).toMatchObject({
      workspace_id: "ws-1",
      group_id: "120@g.us",
      group_name: "Lumeis <> Acme",
      company_id: "co-1",
      ignored: false,
    })
    f = fakeSupabase({ identity_reviews: [grupo] })
    await resolveReview(f.client, CTX, "rev-g", { type: "ignore" })
    expect(f.calls.find((c) => c.table === "whatsapp_group_companies")!.payload).toMatchObject({ company_id: null, ignored: true })
  })
})
```

Ler `src/lib/mcp/fake-supabase.ts` antes: confirmar que `upsert` entra em `calls` com `op: "upsert"` e `payload`. Se o fake não suportar `upsert` ou o `insert().select().single()` do `create_company`, estender o fake no mesmo commit.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/hub/decisions.test.ts`
Expected: os 3 testes novos FAIL ("o caso não tem e-mail para ligar" e afins).

- [ ] **Step 3: Implementar em `decisions.ts`**

Em `ReviewObserved`, acrescentar:

```ts
  /** WhatsApp: telefone E.164 (caso whatsapp_contato). */
  phone?: string
  /** WhatsApp: grupo (caso grupo_sem_empresa). */
  group_id?: string
  group_name?: string | null
```

Trocar o helper `identity` para escolher a chave:

```ts
  // A chave do caso: e-mail (Gmail, Calendar) ou telefone (WhatsApp).
  const key = obs.email ? { kind: "email", value: obs.email } : obs.phone ? { kind: "phone", value: obs.phone } : null
  const identity = (personId: string | null, ignored: boolean) =>
    supabase.from("person_identities").upsert(
      {
        workspace_id: ctx.workspaceId,
        person_id: personId,
        ignored,
        kind: key!.kind,
        value_norm: key!.value,
        value_raw: key!.value,
        source: "review",
        confidence: "confirmed",
      },
      { onConflict: "workspace_id,kind,value_norm" }
    )
  const groupRow = (companyId: string | null, ignored: boolean) =>
    supabase.from("whatsapp_group_companies").upsert(
      {
        workspace_id: ctx.workspaceId,
        group_id: obs.group_id,
        group_name: obs.group_name ?? null,
        company_id: companyId,
        ignored,
        source: "review",
      },
      { onConflict: "workspace_id,group_id" }
    )
```

No `switch`:

- `link_person`: trocar `if (obs.email)` por `if (key)`, e o detalhe por `` `${key.value} → pessoa ${resolution.personId}` ``.
- `link_company`, primeira linha do case:
  ```ts
      if (obs.group_id) {
        write = await groupRow(resolution.companyId, false)
        detail = `grupo ${obs.group_name ?? obs.group_id} → empresa ${resolution.companyId}`
        break
      }
  ```
- `create_company`: aceitar grupo. Trocar a guarda `if (!obs.domain)` por `if (!obs.domain && !obs.group_id)`. Inserir a empresa com `domain: obs.domain ?? null` e, depois do insert:
  ```ts
      write = obs.group_id ? await groupRow(created.id, false) : await domainRow(created.id, false)
      detail = `empresa "${resolution.name}" criada${obs.group_id ? ` para o grupo ${obs.group_name ?? obs.group_id}` : ` com ${obs.domain}`}`
  ```
- `ignore`:
  ```ts
      if (obs.group_id) write = await groupRow(null, true)
      else if (review.reason === "dominio_desconhecido" && obs.domain) write = await domainRow(null, true)
      else if (key) write = await identity(null, true)
  ```

- [ ] **Step 4: Descrições do MCP**

Em `identity-reviews.ts`, na descrição de `list_identity_reviews`, depois de "projeto do TranscriptionApp ainda sem empresa", acrescentar: `, contato e grupo do WhatsApp (só nome e número; a mensagem fica no PC até você confirmar)`. Na descrição de `action`: `link_person: o e-mail (ou o telefone do WhatsApp) é desta pessoa. link_company: o domínio (ou a reunião, o projeto do TranscriptionApp, o grupo do WhatsApp) é desta empresa.`

- [ ] **Step 5: Rodar**

Run: `npx vitest run src/lib/hub/decisions.test.ts src/lib/mcp`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/hub/decisions.ts src/lib/hub/decisions.test.ts src/lib/mcp/tools/hub/identity-reviews.ts src/lib/mcp/fake-supabase.ts
git commit -m "feat(whatsapp): resolver contato e grupo pela fila de identidade"
```

---

### Task 5: Alerta de coletor parado no resumo diário

**Files:**
- Modify: `src/lib/hub/daily-review.ts` (`composeDigest`)
- Modify: `src/lib/hub/sync.ts` (`runDailyReviewAndDigest`)
- Test: `src/lib/hub/daily-review.test.ts`

**Interfaces:**
- Consumes: o cursor `("whatsapp", "heartbeat")` da Task 3.
- Produces: `composeDigest(today, rows, openIdentity, appUrl, alerts: string[] = [])`; `heartbeatAlert(lastBeat: string | null, now: number): string | null`.

- [ ] **Step 1: Testes**

Acrescentar a `daily-review.test.ts`, importando `heartbeatAlert` de `./daily-review`:

```ts
describe("alerta do WhatsApp", () => {
  const NOW_ = Date.parse("2026-10-24T11:00:00Z")
  it("sem batimento nenhum, não alerta (coletor ainda não instalado)", () => {
    expect(heartbeatAlert(null, NOW_)).toBeNull()
  })
  it("batimento de 2 h, sem alerta; de 30 h, alerta com a data", () => {
    expect(heartbeatAlert("2026-10-24T09:00:00Z", NOW_)).toBeNull()
    expect(heartbeatAlert("2026-10-23T05:00:00Z", NOW_)).toBe("WhatsApp parado desde 23/10 02:00: confira o coletor no PC.")
  })
  it("alerta sozinho já faz o resumo sair, e vem antes de tudo", () => {
    const d = composeDigest("2026-10-24", [], 0, "https://crm.example", ["WhatsApp parado desde 23/10 02:00: confira o coletor no PC."])!
    expect(d.subject).toBe("CRM 2026-10-24: alerta do WhatsApp")
    expect(d.html.indexOf("WhatsApp parado")).toBeLessThan(d.html.indexOf("Revisão de"))
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/hub/daily-review.test.ts`
Expected: FAIL (`heartbeatAlert` não existe).

- [ ] **Step 3: Implementar em `daily-review.ts`**

```ts
/** Sem batimento do coletor de WhatsApp há mais disto, o resumo avisa. */
export const WHATSAPP_HEARTBEAT_MAX_MS = 24 * 60 * 60 * 1000

export function heartbeatAlert(lastBeat: string | null, now: number): string | null {
  if (!lastBeat) return null
  if (now - Date.parse(lastBeat) <= WHATSAPP_HEARTBEAT_MAX_MS) return null
  const when = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(lastBeat))
    .replace(",", "")
  return `WhatsApp parado desde ${when}: confira o coletor no PC.`
}
```

Em `composeDigest`, acrescentar o parâmetro `alerts: string[] = []` e:

- trocar a guarda de saída por `if (!alerts.length && !risco.length && !sugestoes.length && !avanco.length && openIdentity === 0) return null`;
- primeira linha do `html`: `alerts.length ? `<p style="color:#b91c1c"><b>${alerts.map(esc).join("<br/>")}</b></p>` : "",`;
- no assunto: `` subject: `CRM ${today}: ${parts.join(", ") || (alerts.length ? "alerta do WhatsApp" : `${openIdentity} na fila`)}` ``.

Conferir o formato exato que o `Intl` dá (`"23/10, 02:00"` ou `"23/10 02:00"`) e ajustar o `.replace` para o teste bater.

- [ ] **Step 4: Ligar em `sync.ts`**

Em `runDailyReviewAndDigest`, importar `heartbeatAlert` e trocar a linha do `composeDigest`:

```ts
  const alerts = [heartbeatAlert(await store.getCursor("whatsapp", "heartbeat"), Date.now())].filter((a): a is string => !!a)
  const digest = composeDigest(review.today, await store.reviewsOn(review.today), await store.openIdentityReviews(), appUrl, alerts)
```

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/hub/daily-review.ts src/lib/hub/daily-review.test.ts src/lib/hub/sync.ts
git commit -m "feat(whatsapp): resumo diário avisa quando o coletor para"
```

---

### Task 6: Pacote do coletor, dia de São Paulo e índice do diretório

**Files:**
- Create: `collectors/whatsapp/package.json`, `tsconfig.json`, `.gitignore`, `.env.example`
- Create: `collectors/whatsapp/src/day.ts`, `src/directory.ts`
- Test: `collectors/whatsapp/src/directory.test.ts`
- Modify: `tsconfig.json` (raiz: `exclude`), `eslint.config.mjs` (raiz: `globalIgnores`), `vitest.config.ts` (raiz: `include`)

**Interfaces:**
- Consumes: `WaDirectory` (Task 1, `import type`); `normalizePersonName`, `companyNameKey` de `src/lib/identity/normalize.ts` (import relativo; o pacote declara `libphonenumber-js` porque `normalize.ts` importa).
- Produces:
  - `saoPauloDay(tsSeconds: number): string` e `saoPauloHHMM(tsSeconds: number): string`
  - `indexDirectory(d: WaDirectory): DirectoryIndex`, com `DirectoryIndex = { personByPhone: Map<string, {personId: string|null; ignored: boolean}>; peopleByName: Map<string, {id: string; companyId: string|null}[]>; companies: {id: string; nameKey: string}[]; groupById: Map<string, {companyId: string|null; ignored: boolean}>; companyByPersonId: Map<string, string|null> }`
  - `nameKey(raw: string): string | null` (reexporta `normalizePersonName`) e `groupKey(raw: string): string` (`companyNameKey` ou `""`)

- [ ] **Step 1: Pacote**

```json
{
  "name": "crmflash-whatsapp-collector",
  "private": true,
  "type": "module",
  "description": "Leitor local, só leitura, do WhatsApp para o CRM Flash",
  "scripts": {
    "start": "tsx src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "dotenv": "^16.4.7",
    "libphonenumber-js": "^1.11.0",
    "qrcode": "^1.5.4",
    "whatsapp-web.js": "^1.34.6"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/qrcode": "^1.5.6",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

Usar no `libphonenumber-js` a mesma versão maior do `package.json` da raiz (conferir lá).

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "../../src/lib/whatsapp/contract.ts", "../../src/lib/identity/normalize.ts"]
}
```

`.gitignore`:

```
node_modules/
.env
session/
.wwebjs_cache/
state.json
```

`.env.example`:

```
CRM_URL=https://crmflash.vercel.app
# Gerado por: node scripts/whatsapp-collector-token.mjs (na raiz do crmflash)
WHATSAPP_COLLECTOR_TOKEN=
WA_SESSION_PATH=./session
# Telefones da Lumeis, com DDI, separados por vírgula. O seu entra sozinho.
WHATSAPP_INTERNAL_PHONES=
PORT=3011
```

- [ ] **Step 2: Isolar o pacote da raiz**

- `tsconfig.json` da raiz: `"exclude": ["node_modules", "collectors"]`.
- `eslint.config.mjs`: acrescentar `"collectors/**",` ao `globalIgnores`.
- `vitest.config.ts`: `include: ["src/**/*.test.ts", "collectors/whatsapp/src/**/*.test.ts"],`.

- [ ] **Step 3: Testes do dia e do índice**

```ts
// collectors/whatsapp/src/directory.test.ts
import { describe, it, expect } from "vitest"
import { saoPauloDay, saoPauloHHMM } from "./day"
import { groupKey, indexDirectory, nameKey } from "./directory"

describe("dia de São Paulo", () => {
  it("01:30 UTC ainda é o dia anterior em São Paulo", () => {
    const ts = Date.parse("2026-10-23T01:30:00Z") / 1000
    expect(saoPauloDay(ts)).toBe("2026-10-22")
    expect(saoPauloHHMM(ts)).toBe("22:30")
  })
})

describe("índice do diretório", () => {
  const idx = indexDirectory({
    generatedAt: "x",
    people: [
      { id: "p1", nameKey: "joao silva", companyId: "c1" },
      { id: "p2", nameKey: "joao silva", companyId: "c2" },
    ],
    companies: [{ id: "c1", nameKey: "acme" }],
    phones: [{ digits: ["5521987654321", "552187654321"], personId: "p1", ignored: false }],
    groups: [{ groupId: "120@g.us", companyId: "c1", ignored: false }],
  })
  it("telefone por qualquer variante", () => {
    expect(idx.personByPhone.get("552187654321")).toEqual({ personId: "p1", ignored: false })
  })
  it("homônimos ficam juntos na mesma chave", () => {
    expect(idx.peopleByName.get("joao silva")!.map((p) => p.id)).toEqual(["p1", "p2"])
  })
  it("chaves de nome iguais às do CRM", () => {
    expect(nameKey("João  SILVA")).toBe("joao silva")
    expect(groupKey("Lumeis <> ACME Ltda.")).toBe("lumeis acme")
  })
})
```

- [ ] **Step 4: Rodar e ver falhar**

Run (na raiz): `npx vitest run collectors/whatsapp/src/directory.test.ts`
Expected: FAIL (módulos não existem).

- [ ] **Step 5: Implementar**

```ts
// collectors/whatsapp/src/day.ts
// O dia do evento é o de São Paulo, igual à revisão diária do CRM.

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" })
const hhmmFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false })

/** Timestamp do WhatsApp (segundos) → "AAAA-MM-DD" em São Paulo. */
export function saoPauloDay(tsSeconds: number): string {
  return dayFmt.format(new Date(tsSeconds * 1000))
}

export function saoPauloHHMM(tsSeconds: number): string {
  return hhmmFmt.format(new Date(tsSeconds * 1000))
}
```

```ts
// collectors/whatsapp/src/directory.ts
import type { WaDirectory } from "../../../src/lib/whatsapp/contract"
import { companyNameKey, normalizePersonName } from "../../../src/lib/identity/normalize"

// O diretório que o CRM manda, em forma de busca. As chaves de nome vêm da
// MESMA normalização do CRM (import direto de normalize.ts): "João  SILVA" no
// celular e "Joao Silva" no CRM dão a mesma chave dos dois lados.

export interface DirectoryIndex {
  personByPhone: Map<string, { personId: string | null; ignored: boolean }>
  peopleByName: Map<string, { id: string; companyId: string | null }[]>
  companies: { id: string; nameKey: string }[]
  groupById: Map<string, { companyId: string | null; ignored: boolean }>
  companyByPersonId: Map<string, string | null>
}

export const nameKey = (raw: string): string | null => normalizePersonName(raw)
export const groupKey = (raw: string): string => companyNameKey(raw) ?? ""

export function indexDirectory(d: WaDirectory): DirectoryIndex {
  const personByPhone = new Map<string, { personId: string | null; ignored: boolean }>()
  for (const p of d.phones) for (const dig of p.digits) personByPhone.set(dig, { personId: p.personId, ignored: p.ignored })
  const peopleByName = new Map<string, { id: string; companyId: string | null }[]>()
  const companyByPersonId = new Map<string, string | null>()
  for (const p of d.people) {
    const list = peopleByName.get(p.nameKey) ?? []
    list.push({ id: p.id, companyId: p.companyId })
    peopleByName.set(p.nameKey, list)
    companyByPersonId.set(p.id, p.companyId)
  }
  const groupById = new Map(d.groups.map((g) => [g.groupId, { companyId: g.companyId, ignored: g.ignored }]))
  return { personByPhone, peopleByName, companies: d.companies, groupById, companyByPersonId }
}
```

- [ ] **Step 6: Rodar**

Run: `npx vitest run collectors/whatsapp/src/directory.test.ts && npx tsc --noEmit`
Expected: PASS; o tsc da raiz ignora `collectors/`.

- [ ] **Step 7: Commit**

```bash
git add collectors/whatsapp tsconfig.json eslint.config.mjs vitest.config.ts
git commit -m "feat(coletor-wa): pacote, dia de São Paulo e índice do diretório"
```

---

### Task 7: Matcher

**Files:**
- Create: `collectors/whatsapp/src/match.ts`
- Test: `collectors/whatsapp/src/match.test.ts`

**Interfaces:**
- Consumes: `DirectoryIndex`, `nameKey`, `groupKey` (Task 6); `WaCandidate` (contrato).
- Produces:
  ```ts
  export interface ChatInfo {
    type: "direct" | "group"
    /** direct: só dígitos, com DDI ("5521987654321"); null se o WhatsApp não expôs o número (LID). */
    phoneDigits: string | null
    groupId: string | null
    /** direct: nome salvo na agenda (contact.name), null se não salvo. group: assunto do grupo. */
    name: string | null
    /** group: dígitos dos participantes que o WhatsApp expôs. */
    participantDigits: string[]
  }
  export type MatchResult =
    | { status: "linked"; chatKey: string; chat: WaDayEventChat }
    | { status: "candidate"; chatKey: string; candidate: WaCandidate }
    | { status: "ignored"; why: string }
  export function chatKeyOf(c: ChatInfo): string | null
  export function matchChat(c: ChatInfo, idx: DirectoryIndex): MatchResult
  ```
  com `WaDayEventChat = WaDayEvent["chat"]`.

- [ ] **Step 1: Testes**

```ts
// collectors/whatsapp/src/match.test.ts
import { describe, it, expect } from "vitest"
import { indexDirectory } from "./directory"
import { matchChat, type ChatInfo } from "./match"

const idx = indexDirectory({
  generatedAt: "x",
  people: [
    { id: "p-joao", nameKey: "joao silva", companyId: "c-acme" },
    { id: "p-ana1", nameKey: "ana souza", companyId: "c-acme" },
    { id: "p-ana2", nameKey: "ana souza", companyId: "c-beta" },
  ],
  companies: [
    { id: "c-acme", nameKey: "acme" },
    { id: "c-trigo", nameKey: "grupo trigo" },
  ],
  phones: [
    { digits: ["5521987654321", "552187654321"], personId: "p-joao", ignored: false },
    { digits: ["5521900000009"], personId: null, ignored: true },
  ],
  groups: [
    { groupId: "g-ligado@g.us", companyId: "c-acme", ignored: false },
    { groupId: "g-familia@g.us", companyId: null, ignored: true },
  ],
})
const direct = (phoneDigits: string | null, name: string | null): ChatInfo => ({ type: "direct", phoneDigits, groupId: null, name, participantDigits: [] })
const group = (groupId: string, name: string, participantDigits: string[] = []): ChatInfo => ({ type: "group", phoneDigits: null, groupId, name, participantDigits })

describe("1:1", () => {
  it("telefone confirmado: vinculada, por qualquer variante", () => {
    expect(matchChat(direct("552187654321", "Qualquer"), idx)).toEqual({
      status: "linked",
      chatKey: "p:+5521987654321",
      chat: { type: "direct", phone: "+5521987654321" },
    })
  })
  it("telefone ignorado: ignorada", () => {
    expect(matchChat(direct("5521900000009", "João Silva"), idx).status).toBe("ignored")
  })
  it("nome salvo igual ao do CRM: candidata, só com nome e número", () => {
    expect(matchChat(direct("5521911112222", "JOÃO silva"), idx)).toEqual({
      status: "candidate",
      chatKey: "p:+5521911112222",
      candidate: { type: "direct", phone: "+5521911112222", contactName: "JOÃO silva", personIds: ["p-joao"] },
    })
  })
  it("homônimos: candidata com os dois", () => {
    const r = matchChat(direct("5521933334444", "Ana Souza"), idx)
    expect(r.status === "candidate" && r.candidate.type === "direct" && r.candidate.personIds).toEqual(["p-ana1", "p-ana2"])
  })
  it("só primeiro nome, sem nome salvo ou sem número: ignorada", () => {
    expect(matchChat(direct("5521955556666", "João"), idx).status).toBe("ignored")
    expect(matchChat(direct("5521955556666", null), idx).status).toBe("ignored")
    expect(matchChat(direct(null, "João Silva"), idx).status).toBe("ignored")
  })
})

describe("grupo", () => {
  it("já ligado: vinculado; ignorado: ignorado", () => {
    expect(matchChat(group("g-ligado@g.us", "qualquer"), idx)).toEqual({
      status: "linked",
      chatKey: "g:g-ligado@g.us",
      chat: { type: "group", groupId: "g-ligado@g.us" },
    })
    expect(matchChat(group("g-familia@g.us", "Lumeis <> Acme"), idx).status).toBe("ignored")
  })
  it("nome do grupo contém o da empresa, como palavra inteira", () => {
    const r = matchChat(group("g-novo@g.us", "Lumeis <> Grupo Trigo | Piloto"), idx)
    expect(r).toEqual({
      status: "candidate",
      chatKey: "g:g-novo@g.us",
      candidate: { type: "group", groupId: "g-novo@g.us", groupName: "Lumeis <> Grupo Trigo | Piloto", companyIds: ["c-trigo"], matchedBy: "nome" },
    })
    expect(matchChat(group("g-x@g.us", "Acmeville churrasco"), idx).status).toBe("ignored")
  })
  it("participante com telefone confirmado: candidato pela empresa dele", () => {
    const r = matchChat(group("g-y@g.us", "Projeto X", ["552187654321"]), idx)
    expect(r.status === "candidate" && r.candidate).toMatchObject({ companyIds: ["c-acme"], matchedBy: "participante" })
  })
  it("nada: ignorado", () => {
    expect(matchChat(group("g-z@g.us", "Futebol de quinta", ["5521977778888"]), idx).status).toBe("ignored")
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run collectors/whatsapp/src/match.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
// collectors/whatsapp/src/match.ts
import type { WaCandidate, WaDayEvent } from "../../../src/lib/whatsapp/contract"
import { groupKey, nameKey, type DirectoryIndex } from "./directory"

// Roda no PC. Decide, conversa a conversa, o que pode sair da máquina:
//   linked    → mensagens vão para o CRM;
//   candidate → só nome e número (ou nome do grupo) vão para a fila;
//   ignored   → nada sai.
// Na dúvida, ignored: uma conversa pessoal enviada não volta atrás.

export type WaDayEventChat = WaDayEvent["chat"]

export interface ChatInfo {
  type: "direct" | "group"
  phoneDigits: string | null
  groupId: string | null
  name: string | null
  participantDigits: string[]
}

export type MatchResult =
  | { status: "linked"; chatKey: string; chat: WaDayEventChat }
  | { status: "candidate"; chatKey: string; candidate: WaCandidate }
  | { status: "ignored"; why: string }

export function chatKeyOf(c: ChatInfo): string | null {
  if (c.type === "group") return c.groupId ? `g:${c.groupId}` : null
  return c.phoneDigits ? `p:+${c.phoneDigits}` : null
}

/** Celular brasileiro sem o nono dígito ganha o 9, como o normalizePhone do CRM. */
function canonicalDigits(d: string): string {
  const m = d.match(/^55(\d{2})([6-9]\d{7})$/)
  return m ? `55${m[1]}9${m[2]}` : d
}

export function matchChat(c: ChatInfo, idx: DirectoryIndex): MatchResult {
  if (c.type === "direct") {
    if (!c.phoneDigits) return { status: "ignored", why: "sem_numero" }
    const known = idx.personByPhone.get(c.phoneDigits) ?? idx.personByPhone.get(canonicalDigits(c.phoneDigits))
    const phone = `+${canonicalDigits(c.phoneDigits)}`
    const chatKey = `p:${phone}`
    if (known) {
      if (known.ignored || !known.personId) return { status: "ignored", why: "telefone_ignorado" }
      return { status: "linked", chatKey, chat: { type: "direct", phone } }
    }
    const key = c.name ? nameKey(c.name) : null
    if (!key || key.split(" ").length < 2) return { status: "ignored", why: "sem_nome_completo" }
    const people = idx.peopleByName.get(key)
    if (!people?.length) return { status: "ignored", why: "nome_nao_casou" }
    return {
      status: "candidate",
      chatKey,
      candidate: { type: "direct", phone, contactName: c.name!, personIds: people.map((p) => p.id) },
    }
  }

  if (!c.groupId) return { status: "ignored", why: "sem_id" }
  const chatKey = `g:${c.groupId}`
  const known = idx.groupById.get(c.groupId)
  if (known) {
    if (known.ignored || !known.companyId) return { status: "ignored", why: "grupo_ignorado" }
    return { status: "linked", chatKey, chat: { type: "group", groupId: c.groupId } }
  }

  const name = c.name ?? ""
  const gk = ` ${groupKey(name)} `
  const byName = idx.companies.filter((co) => gk.includes(` ${co.nameKey} `)).map((co) => co.id)
  if (byName.length) {
    return {
      status: "candidate",
      chatKey,
      candidate: { type: "group", groupId: c.groupId, groupName: name, companyIds: byName, matchedBy: "nome" },
    }
  }

  const byMember = new Set<string>()
  for (const d of c.participantDigits) {
    const p = idx.personByPhone.get(d) ?? idx.personByPhone.get(canonicalDigits(d))
    const companyId = p?.personId && !p.ignored ? idx.companyByPersonId.get(p.personId) : null
    if (companyId) byMember.add(companyId)
  }
  if (byMember.size) {
    return {
      status: "candidate",
      chatKey,
      candidate: { type: "group", groupId: c.groupId, groupName: name, companyIds: [...byMember], matchedBy: "participante" },
    }
  }
  return { status: "ignored", why: "grupo_sem_sinal" }
}
```

- [ ] **Step 4: Rodar**

Run: `npx vitest run collectors/whatsapp/src/match.test.ts`
Expected: PASS (9 testes).

- [ ] **Step 5: Commit**

```bash
git add collectors/whatsapp/src/match.ts collectors/whatsapp/src/match.test.ts
git commit -m "feat(coletor-wa): casamento local de conversa e grupo"
```

---

### Task 8: Agregador do dia

**Files:**
- Create: `collectors/whatsapp/src/aggregate.ts`
- Test: `collectors/whatsapp/src/aggregate.test.ts`

**Interfaces:**
- Consumes: `saoPauloDay`, `saoPauloHHMM` (Task 6); `WaDayEvent`, `WaDayEventChat`.
- Produces:
  ```ts
  export interface WaMessage {
    id: string
    timestamp: number          // segundos
    fromMe: boolean
    /** Dígitos de quem mandou (em grupo, o autor); null se desconhecido. */
    authorDigits: string | null
    authorName: string         // nome para a linha "HH:MM Nome: texto"
    type: string               // "chat" | "ptt" | "audio" | "image" | "video" | "document" | "sticker" | "revoked" | "e2e_notification" | …
    body: string
    fileName: string | null
  }
  export const TEXT_LIMIT = 4000
  export function aggregateDays(chatKey: string, chat: WaDayEventChat, chatName: string, messages: WaMessage[], internalDigits: Set<string>): WaDayEvent[]
  ```

- [ ] **Step 1: Testes**

```ts
// collectors/whatsapp/src/aggregate.test.ts
import { describe, it, expect } from "vitest"
import { aggregateDays, TEXT_LIMIT, type WaMessage } from "./aggregate"

const T = (iso: string) => Date.parse(iso) / 1000
const m = (over: Partial<WaMessage>): WaMessage => ({
  id: "x",
  timestamp: T("2026-10-22T17:30:00Z"),
  fromMe: false,
  authorDigits: "5521900000001",
  authorName: "João Silva",
  type: "chat",
  body: "oi",
  fileName: null,
  ...over,
})
const CHAT = { type: "direct" as const, phone: "+5521900000001" }
const INTERNAL = new Set(["5521988887777"])

describe("agregado do dia", () => {
  it("os dois lados no mesmo dia viram dois eventos, cada um com a sua última mensagem", () => {
    const evs = aggregateDays("p:+5521900000001", CHAT, "João Silva", [
      m({ id: "a", body: "segue o export" }),
      m({ id: "b", fromMe: true, authorDigits: null, authorName: "Gabriel", timestamp: T("2026-10-22T17:35:00Z"), body: "valeu" }),
      m({ id: "c", timestamp: T("2026-10-22T17:40:00Z"), body: "falamos quinta?" }),
    ], INTERNAL)
    expect(evs.map((e) => [e.direction, e.messageCount, e.lastMessage.id, e.lastAt])).toEqual([
      ["received", 2, "c", "2026-10-22T17:40:00.000Z"],
      ["sent", 1, "b", "2026-10-22T17:35:00.000Z"],
    ])
    expect(evs[0].text).toBe("14:30 João Silva: segue o export\n14:35 Gabriel: valeu\n14:40 João Silva: falamos quinta?")
    expect(evs[0].text).toBe(evs[1].text)
    expect(evs[0].speakerPhones).toEqual(["+5521900000001"])
    expect(evs[0].day).toBe("2026-10-22")
  })

  it("colega da Lumeis num grupo conta como enviado", () => {
    const evs = aggregateDays("g:1@g.us", { type: "group", groupId: "1@g.us" }, "Lumeis <> Acme", [
      m({ id: "r", authorDigits: "5521988887777", authorName: "Rafa" }),
    ], INTERNAL)
    expect(evs.map((e) => e.direction)).toEqual(["sent"])
  })

  it("mídia vira marcador; apagada e de sistema saem", () => {
    const evs = aggregateDays("p:+5521900000001", CHAT, "João Silva", [
      m({ id: "1", type: "ptt", body: "" }),
      m({ id: "2", type: "document", body: "", fileName: "proposta.pdf" }),
      m({ id: "3", type: "revoked", body: "" }),
      m({ id: "4", type: "e2e_notification", body: "" }),
    ], INTERNAL)
    expect(evs[0].messageCount).toBe(2)
    expect(evs[0].text).toBe("14:30 João Silva: [áudio]\n14:30 João Silva: [arquivo: proposta.pdf]")
  })

  it("virada do dia em São Paulo separa os eventos", () => {
    const evs = aggregateDays("p:+5521900000001", CHAT, "João Silva", [
      m({ id: "1", timestamp: T("2026-10-23T02:50:00Z") }), // 23:50 do dia 22 em SP
      m({ id: "2", timestamp: T("2026-10-23T03:10:00Z") }), // 00:10 do dia 23 em SP
    ], INTERNAL)
    expect(evs.map((e) => e.day)).toEqual(["2026-10-22", "2026-10-23"])
  })

  it("texto longo corta o começo e mantém o fim; citação ≤ 280", () => {
    const long = Array.from({ length: 200 }, (_, i) => m({ id: `l${i}`, body: `mensagem ${i} ` + "x".repeat(40) }))
    const [ev] = aggregateDays("p:+5521900000001", CHAT, "João Silva", long, INTERNAL)
    expect(ev.text.length).toBeLessThanOrEqual(TEXT_LIMIT)
    expect(ev.text.startsWith("…")).toBe(true)
    expect(ev.text.endsWith("mensagem 199 " + "x".repeat(40))).toBe(true)
    const [big] = aggregateDays("p:+5521900000001", CHAT, "João Silva", [m({ body: "y".repeat(1000) })], INTERNAL)
    expect(big.lastMessage.quote.length).toBe(280)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run collectors/whatsapp/src/aggregate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
// collectors/whatsapp/src/aggregate.ts
import type { WaDayEvent } from "../../../src/lib/whatsapp/contract"
import { saoPauloDay, saoPauloHHMM } from "./day"
import type { WaDayEventChat } from "./match"

// Mensagens de uma conversa → um evento por dia (São Paulo) por sentido.
// O texto do dia (as duas vozes) vai nos dois eventos: é o que a revisão
// diária lê. O sentido decide só quem agiu.

export interface WaMessage {
  id: string
  timestamp: number
  fromMe: boolean
  authorDigits: string | null
  authorName: string
  type: string
  body: string
  fileName: string | null
}

export const TEXT_LIMIT = 4000
const QUOTE_LIMIT = 280

const SKIP = new Set(["revoked", "e2e_notification", "notification", "notification_template", "gp2", "call_log", "protocol", "ciphertext"])

function render(msg: WaMessage): string | null {
  if (SKIP.has(msg.type)) return null
  switch (msg.type) {
    case "chat":
      return msg.body.trim() || null
    case "ptt":
    case "audio":
      return "[áudio]"
    case "image":
      return msg.body.trim() ? `[imagem] ${msg.body.trim()}` : "[imagem]"
    case "video":
      return msg.body.trim() ? `[vídeo] ${msg.body.trim()}` : "[vídeo]"
    case "document":
      return `[arquivo: ${msg.fileName ?? "sem nome"}]`
    case "sticker":
      return "[figurinha]"
    default:
      return msg.body.trim() || `[${msg.type}]`
  }
}

/** Mantém o fim: a conversa mais recente é a que importa para o próximo passo. */
function clip(text: string): string {
  if (text.length <= TEXT_LIMIT) return text
  const tail = text.slice(text.length - (TEXT_LIMIT - 1))
  const cut = tail.indexOf("\n")
  return `…${cut >= 0 && cut < 200 ? tail.slice(cut) : tail}`
}

export function aggregateDays(
  chatKey: string,
  chat: WaDayEventChat,
  chatName: string,
  messages: WaMessage[],
  internalDigits: Set<string>
): WaDayEvent[] {
  const byDay = new Map<string, { msg: WaMessage; line: string; ours: boolean }[]>()
  for (const msg of [...messages].sort((a, b) => a.timestamp - b.timestamp)) {
    const content = render(msg)
    if (!content) continue
    const ours = msg.fromMe || (!!msg.authorDigits && internalDigits.has(msg.authorDigits))
    const day = saoPauloDay(msg.timestamp)
    const list = byDay.get(day) ?? []
    list.push({ msg, line: `${saoPauloHHMM(msg.timestamp)} ${msg.authorName}: ${content}`, ours })
    byDay.set(day, list)
  }

  const out: WaDayEvent[] = []
  for (const [day, items] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const text = clip(items.map((i) => i.line).join("\n"))
    for (const direction of ["received", "sent"] as const) {
      const side = items.filter((i) => (direction === "sent" ? i.ours : !i.ours))
      if (!side.length) continue
      const last = side[side.length - 1].msg
      out.push({
        chatKey,
        chat,
        chatName,
        day,
        direction,
        messageCount: side.length,
        lastAt: new Date(last.timestamp * 1000).toISOString(),
        text,
        lastMessage: { id: last.id, quote: (render(last) ?? "").slice(0, QUOTE_LIMIT) },
        speakerPhones:
          direction === "received" ? [...new Set(side.map((i) => i.msg.authorDigits).filter((d): d is string => !!d))].map((d) => `+${d}`) : [],
      })
    }
  }
  return out
}
```

- [ ] **Step 4: Rodar**

Run: `npx vitest run collectors/whatsapp/src/aggregate.test.ts`
Expected: PASS (5 testes). O teste de corte usa 200 linhas de ~60 caracteres; se o `…` com corte de linha quebrar o `endsWith`, ajustar `clip` e não o teste.

- [ ] **Step 5: Commit**

```bash
git add collectors/whatsapp/src/aggregate.ts collectors/whatsapp/src/aggregate.test.ts
git commit -m "feat(coletor-wa): agregado do dia por sentido"
```

---

### Task 9: Ciclo, estado local e cliente do CRM

**Files:**
- Create: `collectors/whatsapp/src/cycle.ts`, `src/state.ts`, `src/crm-client.ts`
- Test: `collectors/whatsapp/src/cycle.test.ts`

**Interfaces:**
- Consumes: `indexDirectory` (6), `matchChat`, `chatKeyOf`, `ChatInfo` (7), `aggregateDays`, `WaMessage` (8); contrato.
- Produces:
  ```ts
  // cycle.ts
  export interface WaSource {
    listChats(): Promise<(ChatInfo & { id: string; lastActivity: number })[]>
    /** Mensagens da conversa com timestamp ≥ sinceSeconds (o leitor decide quantas buscar). */
    messagesSince(chatId: string, sinceSeconds: number): Promise<WaMessage[]>
  }
  export interface CrmApi {
    directory(): Promise<WaDirectory>
    candidates(list: WaCandidate[]): Promise<WaCandidatesResult>
    events(list: WaDayEvent[]): Promise<WaEventsResult>
  }
  export interface CycleState {
    /** chatKey → timestamp (s) da última mensagem já enviada ao CRM. */
    sent: Record<string, number>
    /** chatKeys já mandados como candidatos (não reenvia a cada ciclo). */
    proposed: string[]
    /** Último POST de eventos (ms), para o batimento. */
    lastBeatMs: number
  }
  export const WINDOW_DAYS = 30
  export const HEARTBEAT_MS = 60 * 60 * 1000
  export async function runCycle(src: WaSource, crm: CrmApi, state: CycleState, opts: { now: number; internalDigits: Set<string>; chatName?: (c: ChatInfo & { id: string }) => string }): Promise<{ linked: number; candidates: number; events: number; rejected: number }>
  // state.ts
  export function loadState(path: string): CycleState
  export function saveState(path: string, s: CycleState): void
  // crm-client.ts
  export function crmClient(baseUrl: string, token: string): CrmApi
  ```

- [ ] **Step 1: Testes do ciclo**

```ts
// collectors/whatsapp/src/cycle.test.ts
import { describe, it, expect } from "vitest"
import type { WaCandidate, WaDayEvent, WaDirectory } from "../../../src/lib/whatsapp/contract"
import { runCycle, type CrmApi, type CycleState, type WaSource } from "./cycle"
import type { WaMessage } from "./aggregate"

const NOW = Date.parse("2026-10-23T15:00:00Z")
const T = (iso: string) => Date.parse(iso) / 1000

const DIR: WaDirectory = {
  generatedAt: "x",
  people: [{ id: "p-joao", nameKey: "joao silva", companyId: "c-acme" }],
  companies: [],
  phones: [{ digits: ["5521900000001"], personId: "p-joao", ignored: false }],
  groups: [],
}

class FakeCrm implements CrmApi {
  sentCandidates: WaCandidate[] = []
  sentEvents: WaDayEvent[] = []
  eventCalls = 0
  async directory() {
    return DIR
  }
  async candidates(list: WaCandidate[]) {
    this.sentCandidates.push(...list)
    return { opened: list.length, skipped: 0 }
  }
  async events(list: WaDayEvent[]) {
    this.eventCalls++
    this.sentEvents.push(...list)
    return { recorded: list.length, rejected: [] }
  }
}

const msg = (id: string, iso: string, fromMe = false): WaMessage => ({
  id,
  timestamp: T(iso),
  fromMe,
  authorDigits: fromMe ? null : "5521900000001",
  authorName: fromMe ? "Gabriel" : "João Silva",
  type: "chat",
  body: id,
  fileName: null,
})

function source(): WaSource & { asked: [string, number][] } {
  const box: Record<string, WaMessage[]> = {
    joao: [msg("m1", "2026-10-20T13:00:00Z"), msg("m2", "2026-10-23T14:00:00Z")],
    pessoal: [msg("x1", "2026-10-23T14:00:00Z")],
    nova: [msg("n1", "2026-10-23T14:00:00Z")],
  }
  const asked: [string, number][] = []
  return {
    asked,
    async listChats() {
      return [
        { id: "joao", type: "direct", phoneDigits: "5521900000001", groupId: null, name: "João", participantDigits: [], lastActivity: T("2026-10-23T14:00:00Z") },
        { id: "pessoal", type: "direct", phoneDigits: "5521977776666", groupId: null, name: "Mãe", participantDigits: [], lastActivity: T("2026-10-23T14:00:00Z") },
        { id: "nova", type: "direct", phoneDigits: "5521955554444", groupId: null, name: "João Silva", participantDigits: [], lastActivity: T("2026-10-23T14:00:00Z") },
        { id: "velha", type: "direct", phoneDigits: "5521900000001", groupId: null, name: "João", participantDigits: [], lastActivity: T("2026-08-01T14:00:00Z") },
      ]
    },
    async messagesSince(chatId: string, since: number) {
      asked.push([chatId, since])
      return (box[chatId] ?? []).filter((m) => m.timestamp >= since)
    },
  }
}
const fresh = (): CycleState => ({ sent: {}, proposed: [], lastBeatMs: 0 })

describe("ciclo do coletor", () => {
  it("só lê mensagem de conversa vinculada; pessoal nunca é lida nem enviada", async () => {
    const src = source()
    const crm = new FakeCrm()
    const r = await runCycle(src, crm, fresh(), { now: NOW, internalDigits: new Set() })
    expect(src.asked.map(([id]) => id)).toEqual(["joao"])
    expect(crm.sentEvents.every((e) => e.chatKey === "p:+5521900000001")).toBe(true)
    expect(r).toMatchObject({ linked: 1, candidates: 1 })
    expect(crm.sentCandidates).toEqual([{ type: "direct", phone: "+5521955554444", contactName: "João Silva", personIds: ["p-joao"] }])
  })

  it("primeira vez: backfill de 30 dias; depois, só o que mudou, sem reenviar candidato", async () => {
    const src = source()
    const crm = new FakeCrm()
    const state = fresh()
    await runCycle(src, crm, state, { now: NOW, internalDigits: new Set() })
    expect(src.asked[0][1]).toBe(Math.floor((NOW - 30 * 86_400_000) / 1000))
    expect(crm.sentEvents.map((e) => e.day)).toEqual(["2026-10-20", "2026-10-23"])
    expect(state.sent["p:+5521900000001"]).toBe(T("2026-10-23T14:00:00Z"))

    src.asked.length = 0
    crm.sentEvents = []
    crm.sentCandidates = []
    await runCycle(src, crm, state, { now: NOW + 5 * 60_000, internalDigits: new Set() })
    expect(src.asked).toEqual([])
    expect(crm.sentCandidates).toEqual([])
  })

  it("mensagem nova reenvia o dia inteiro dela (o CRM atualiza pela versão)", async () => {
    const src = source()
    const crm = new FakeCrm()
    const state: CycleState = { sent: { "p:+5521900000001": T("2026-10-23T12:00:00Z") }, proposed: [], lastBeatMs: NOW }
    await runCycle(src, crm, state, { now: NOW, internalDigits: new Set() })
    // Começo do dia 23 em São Paulo = 03:00 UTC.
    expect(src.asked).toEqual([["joao", T("2026-10-23T03:00:00Z")]])
    expect(crm.sentEvents.map((e) => e.day)).toEqual(["2026-10-23"])
  })

  it("sem nada a enviar, bate o coração uma vez por hora", async () => {
    const crm = new FakeCrm()
    const src: WaSource = { listChats: async () => [], messagesSince: async () => [] }
    const state = fresh()
    await runCycle(src, crm, state, { now: NOW, internalDigits: new Set() })
    await runCycle(src, crm, state, { now: NOW + 10 * 60_000, internalDigits: new Set() })
    expect(crm.eventCalls).toBe(1)
    await runCycle(src, crm, state, { now: NOW + 61 * 60_000, internalDigits: new Set() })
    expect(crm.eventCalls).toBe(2)
  })

  it("CRM recusou ou caiu: o estado não avança", async () => {
    const src = source()
    const crm = new FakeCrm()
    crm.events = async () => {
      throw new Error("503")
    }
    const state = fresh()
    await expect(runCycle(src, crm, state, { now: NOW, internalDigits: new Set() })).rejects.toThrow("503")
    expect(state.sent).toEqual({})
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run collectors/whatsapp/src/cycle.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `cycle.ts`**

```ts
// collectors/whatsapp/src/cycle.ts
import type { WaCandidate, WaCandidatesResult, WaDayEvent, WaDirectory, WaEventsResult } from "../../../src/lib/whatsapp/contract"
import { aggregateDays, type WaMessage } from "./aggregate"
import { saoPauloDay } from "./day"
import { indexDirectory } from "./directory"
import { matchChat, type ChatInfo } from "./match"

// Um ciclo do coletor. Sem WhatsApp e sem rede aqui dentro: só as interfaces,
// para o teste provar o que sai do PC e o que não sai.
//
//   1. diretório do CRM → índice;
//   2. conversas com atividade nos últimos 30 dias → matcher;
//   3. candidatas novas → POST /candidates (só nome e número);
//   4. vinculadas com mensagem nova → lê desde o começo do dia da última
//      enviada (ou 30 dias, na primeira vez), agrega, POST /events;
//   5. o estado só avança depois do 200.

export interface WaSource {
  listChats(): Promise<(ChatInfo & { id: string; lastActivity: number })[]>
  messagesSince(chatId: string, sinceSeconds: number): Promise<WaMessage[]>
}

export interface CrmApi {
  directory(): Promise<WaDirectory>
  candidates(list: WaCandidate[]): Promise<WaCandidatesResult>
  events(list: WaDayEvent[]): Promise<WaEventsResult>
}

export interface CycleState {
  sent: Record<string, number>
  proposed: string[]
  lastBeatMs: number
}

export const WINDOW_DAYS = 30
export const HEARTBEAT_MS = 60 * 60 * 1000
const BATCH = 50
const DAY_MS = 86_400_000

/** Começo (em segundos) do dia de São Paulo que contém o timestamp. SP é UTC-3 o ano todo desde 2019. */
function startOfSaoPauloDay(tsSeconds: number): number {
  return Date.parse(`${saoPauloDay(tsSeconds)}T03:00:00Z`) / 1000
}

export async function runCycle(
  src: WaSource,
  crm: CrmApi,
  state: CycleState,
  opts: { now: number; internalDigits: Set<string>; chatName?: (c: ChatInfo & { id: string }) => string }
): Promise<{ linked: number; candidates: number; events: number; rejected: number }> {
  const idx = indexDirectory(await crm.directory())
  const windowStart = Math.floor((opts.now - WINDOW_DAYS * DAY_MS) / 1000)
  const chats = (await src.listChats()).filter((c) => c.lastActivity >= windowStart)

  const candidates: { key: string; c: WaCandidate }[] = []
  const pending: WaDayEvent[] = []
  const advance: Record<string, number> = {}
  let linked = 0

  for (const chat of chats) {
    const r = matchChat(chat, idx)
    if (r.status === "ignored") continue
    if (r.status === "candidate") {
      if (!state.proposed.includes(r.chatKey)) candidates.push({ key: r.chatKey, c: r.candidate })
      continue
    }
    linked++
    const last = state.sent[r.chatKey]
    if (last !== undefined && chat.lastActivity <= last) continue
    const since = last === undefined ? windowStart : startOfSaoPauloDay(last)
    const messages = await src.messagesSince(chat.id, since)
    if (!messages.length) continue
    const name = opts.chatName?.(chat) ?? chat.name ?? r.chatKey
    pending.push(...aggregateDays(r.chatKey, r.chat, name, messages, opts.internalDigits))
    advance[r.chatKey] = Math.max(...messages.map((m) => m.timestamp))
  }

  if (candidates.length) {
    await crm.candidates(candidates.map((x) => x.c))
    state.proposed.push(...candidates.map((x) => x.key))
  }

  let rejected = 0
  if (pending.length || opts.now - state.lastBeatMs >= HEARTBEAT_MS) {
    for (let i = 0; i < Math.max(pending.length, 1); i += BATCH) {
      const res = await crm.events(pending.slice(i, i + BATCH))
      rejected += res.rejected.length
    }
    state.lastBeatMs = opts.now
    Object.assign(state.sent, advance)
  }
  return { linked, candidates: candidates.length, events: pending.length, rejected }
}
```

Um detalhe do teste "primeira vez": a conversa `velha` tem o mesmo telefone do João, mas `lastActivity` fora da janela, então é filtrada antes do matcher. Se o leitor real devolver duas conversas com a mesma `chatKey` dentro da janela, a segunda é lida também; o CRM deduplica pela chave do dia.

- [ ] **Step 4: Implementar `state.ts` e `crm-client.ts`**

```ts
// collectors/whatsapp/src/state.ts
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import type { CycleState } from "./cycle"

export function loadState(path: string): CycleState {
  if (!existsSync(path)) return { sent: {}, proposed: [], lastBeatMs: 0 }
  const s = JSON.parse(readFileSync(path, "utf8")) as Partial<CycleState>
  return { sent: s.sent ?? {}, proposed: s.proposed ?? [], lastBeatMs: s.lastBeatMs ?? 0 }
}

/** Grava num temporário e renomeia: PC desligado no meio não corrompe o estado. */
export function saveState(path: string, s: CycleState): void {
  writeFileSync(`${path}.tmp`, JSON.stringify(s, null, 2))
  renameSync(`${path}.tmp`, path)
}
```

```ts
// collectors/whatsapp/src/crm-client.ts
import type { WaCandidate, WaCandidatesResult, WaDayEvent, WaDirectory, WaEventsResult } from "../../../src/lib/whatsapp/contract"
import type { CrmApi } from "./cycle"

export function crmClient(baseUrl: string, token: string): CrmApi {
  const base = baseUrl.replace(/\/$/, "")
  async function call<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${base}/api/hub/whatsapp/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`CRM ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`)
    return (await res.json()) as T
  }
  return {
    directory: () => call<WaDirectory>("directory"),
    candidates: (list: WaCandidate[]) => call<WaCandidatesResult>("candidates", { candidates: list }),
    events: (list: WaDayEvent[]) => call<WaEventsResult>("events", { events: list }),
  }
}
```

- [ ] **Step 5: Rodar**

Run: `npx vitest run collectors/whatsapp/src/cycle.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 6: Commit**

```bash
git add collectors/whatsapp/src/cycle.ts collectors/whatsapp/src/cycle.test.ts collectors/whatsapp/src/state.ts collectors/whatsapp/src/crm-client.ts
git commit -m "feat(coletor-wa): ciclo, estado local e cliente do CRM"
```

---

### Task 10: Leitor só leitura, painel, processo e guarda

**Files:**
- Create: `collectors/whatsapp/src/readonly.ts`, `src/web.ts`, `src/index.ts`
- Create: `collectors/whatsapp/src/readonly-guard.test.ts`
- Create: `collectors/whatsapp/ecosystem.config.cjs`, `start-hidden.vbs`, `Dockerfile`, `README.md`
- Modify: `docs/memory.md` (entrada da fase 4)

**Interfaces:**
- Consumes: `WaSource`, `runCycle`, `loadState`, `saveState`, `crmClient` (Task 9); `ChatInfo` (7); `WaMessage` (8).
- Produces: `ReadOnlyWhatsApp` (implementa `WaSource`) e o processo `npm start`.

- [ ] **Step 1: Teste da guarda**

```ts
// collectors/whatsapp/src/readonly-guard.test.ts
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// A garantia de só leitura não é disciplina, é teste: nenhum arquivo do
// coletor pode citar um método que escreve no WhatsApp.
const FORBIDDEN = [
  "sendMessage",
  "sendSeen",
  "markRead",
  "sendPresenceAvailable",
  "sendPresenceUnavailable",
  "sendStateTyping",
  "sendStateRecording",
  ".reply(",
  ".react(",
  ".forward(",
  ".delete(",
  "archiveChat",
  "pinChat",
  "muteChat",
  "markChatUnread",
  "createGroup",
  "addParticipants",
]

describe("coletor só leitura", () => {
  it("nenhum arquivo do coletor usa método que escreve no WhatsApp", () => {
    const dir = fileURLToPath(new URL(".", import.meta.url))
    const offenders: string[] = []
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "readonly-guard.test.ts")) {
      const src = readFileSync(`${dir}/${f}`, "utf8")
      for (const w of FORBIDDEN) if (src.includes(w)) offenders.push(`${f}: ${w}`)
    }
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: `readonly.ts`**

```ts
// collectors/whatsapp/src/readonly.ts
import pkg from "whatsapp-web.js"
import type { WaMessage } from "./aggregate"
import type { WaSource } from "./cycle"
import type { ChatInfo } from "./match"

// O único arquivo que toca o whatsapp-web.js. Expõe só leitura (WaSource);
// readonly-guard.test.ts falha se aparecer qualquer método de escrita.
//
// LID: o WhatsApp vem trocando o id das pessoas por um "@lid" sem telefone.
// O número sai de contact.number quando o WhatsApp o expõe; sem número, a
// conversa é ignorada (o matcher exige telefone para 1:1).

type Client = InstanceType<typeof pkg.Client>
type Chat = Awaited<ReturnType<Client["getChats"]>>[number]

const digitsOnly = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "") || null

export class ReadOnlyWhatsApp implements WaSource {
  private chats = new Map<string, Chat>()
  private names = new Map<string, string>()

  constructor(private client: Client, private myName: string) {}

  /** Nome para o cabeçalho do evento: o salvo na agenda, senão o do perfil, senão o número. */
  displayName(id: string): string | undefined {
    return this.names.get(id)
  }

  async listChats(): Promise<(ChatInfo & { id: string; lastActivity: number })[]> {
    const out: (ChatInfo & { id: string; lastActivity: number })[] = []
    for (const chat of await this.client.getChats()) {
      const id = chat.id._serialized
      this.chats.set(id, chat)
      if (chat.isGroup) {
        const participants = ((chat as unknown as { participants?: { id: { _serialized: string; user: string; server: string } }[] }).participants ?? [])
          .filter((p) => p.id.server === "c.us")
          .map((p) => p.id.user)
        this.names.set(id, chat.name)
        out.push({ id, type: "group", phoneDigits: null, groupId: id, name: chat.name, participantDigits: participants, lastActivity: chat.timestamp ?? 0 })
        continue
      }
      if (chat.id.server !== "c.us" && chat.id.server !== "lid") continue // status, newsletter, broadcast
      const contact = await chat.getContact()
      const phone = digitsOnly(contact.number) ?? (chat.id.server === "c.us" ? chat.id.user : null)
      const saved = contact.isMyContact ? contact.name ?? null : null
      this.names.set(id, saved ?? contact.pushname ?? (phone ? `+${phone}` : id))
      out.push({ id, type: "direct", phoneDigits: phone, groupId: null, name: saved, participantDigits: [], lastActivity: chat.timestamp ?? 0 })
    }
    return out
  }

  async messagesSince(chatId: string, sinceSeconds: number): Promise<WaMessage[]> {
    const chat = this.chats.get(chatId) ?? (await this.client.getChatById(chatId))
    // fetchMessages não marca como lida. Busca em degraus até cobrir o período.
    let limit = 100
    let msgs = await chat.fetchMessages({ limit })
    while (msgs.length === limit && msgs[0].timestamp > sinceSeconds && limit < 3200) {
      limit *= 2
      msgs = await chat.fetchMessages({ limit })
    }
    const out: WaMessage[] = []
    for (const m of msgs) {
      if (m.timestamp < sinceSeconds) continue
      let authorDigits: string | null = null
      let authorName = this.myName
      if (!m.fromMe) {
        try {
          const c = await m.getContact()
          authorDigits = digitsOnly(c.number)
          authorName = (c.isMyContact ? c.name : null) ?? c.pushname ?? (authorDigits ? `+${authorDigits}` : "?")
        } catch {
          authorName = "?"
        }
      }
      out.push({
        id: m.id._serialized,
        timestamp: m.timestamp,
        fromMe: m.fromMe,
        authorDigits,
        authorName,
        type: m.type,
        body: m.body ?? "",
        fileName: (m as unknown as { _data?: { filename?: string } })._data?.filename ?? null,
      })
    }
    return out
  }
}
```

Na hora de rodar, conferir no `node_modules/whatsapp-web.js/index.d.ts` os nomes reais (`Contact.number`, `isMyContact`, `pushname`, `Chat.timestamp`, `GroupChat.participants`) e ajustar os casts. Os testes não cobrem este arquivo; ele é validado no passo de pareamento (Task 11).

- [ ] **Step 3: `web.ts`**

Copiar `~/Documents/whatsapp-obsidian/src/web.ts` para `collectors/whatsapp/src/web.ts` e mudar:

- `<title>` e `<h1>` para `WhatsApp → CRM (só leitura)`;
- o texto de conectado para `Lendo as conversas confirmadas. Nada é enviado, nada é marcado como lido.`;
- acrescentar `export function updateStats(s: string)`, que guarda a última linha do ciclo (ex.: `12 vinculadas, 2 candidatas, 5 eventos`) e a mostra no bloco "Última atividade".

- [ ] **Step 4: `index.ts`**

```ts
// collectors/whatsapp/src/index.ts
import "dotenv/config"
import path from "node:path"
import pkg from "whatsapp-web.js"
import { crmClient } from "./crm-client"
import { runCycle } from "./cycle"
import { ReadOnlyWhatsApp } from "./readonly"
import { loadState, saveState } from "./state"
import { startWebServer, updateLastMessage, updateQR, updateStats, updateStatus } from "./web"

const { Client, LocalAuth } = pkg

const CRM_URL = process.env.CRM_URL || "https://crmflash.vercel.app"
const TOKEN = process.env.WHATSAPP_COLLECTOR_TOKEN
if (!TOKEN) throw new Error("WHATSAPP_COLLECTOR_TOKEN não configurado (rode scripts/whatsapp-collector-token.mjs na raiz do crmflash)")
const SESSION = path.resolve(process.env.WA_SESSION_PATH || "./session")
const STATE = path.resolve(process.env.WA_STATE_PATH || "./state.json")
const PORT = parseInt(process.env.PORT || "3011", 10)
const CYCLE_MS = 5 * 60 * 1000

const internal = new Set(
  (process.env.WHATSAPP_INTERNAL_PHONES ?? "")
    .split(",")
    .map((p) => p.replace(/\D/g, ""))
    .filter(Boolean)
)

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSION, clientId: "crm" }),
  puppeteer: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] },
})
const crm = crmClient(CRM_URL, TOKEN)
let reader: ReadOnlyWhatsApp | null = null
let running = false

async function cycle() {
  if (!reader || running) return
  running = true
  try {
    const state = loadState(STATE)
    const r = await runCycle(reader, crm, state, {
      now: Date.now(),
      internalDigits: internal,
      chatName: (c) => reader!.displayName(c.id) ?? c.name ?? "",
    })
    saveState(STATE, state)
    const line = `${r.linked} vinculadas, ${r.candidates} candidatas novas, ${r.events} eventos, ${r.rejected} recusados`
    console.log(`[ciclo] ${line}`)
    updateStats(line)
  } catch (e) {
    console.error("[ciclo] erro:", e)
    updateLastMessage(`❌ ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    running = false
  }
}

client.on("qr", (qr: string) => updateQR(qr))
client.on("ready", async () => {
  updateStatus("connected")
  const me = client.info?.wid?.user
  if (me) internal.add(me)
  reader = new ReadOnlyWhatsApp(client, client.info?.pushname || "Gabriel")
  console.log("[WhatsApp] conectado, só leitura")
  await cycle()
})
client.on("disconnected", (reason: string) => {
  updateStatus("disconnected")
  reader = null
  console.log(`[WhatsApp] desconectado: ${reason}`)
})

setInterval(cycle, CYCLE_MS)
startWebServer(PORT)
client.initialize()
```

- [ ] **Step 5: Operação**

`ecosystem.config.cjs`:

```js
module.exports = {
  apps: [
    {
      name: "whatsapp-crm",
      interpreter: "node",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "src/index.ts",
      cwd: __dirname,
      env: { NODE_ENV: "production" },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 10000,
    },
  ],
}
```

`start-hidden.vbs` (no padrão do `whatsapp-obsidian/scripts/start-hidden.vbs`; ler aquele antes e espelhar):

```vbs
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "cmd /c npm start >> collector.log 2>&1", 0, False
```

Acrescentar `collector.log` ao `.gitignore` do coletor.

`Dockerfile` (para a opção B; não é usado agora):

```dockerfile
FROM node:22-slim
RUN apt-get update && apt-get install -y chromium ca-certificates --no-install-recommends && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
WORKDIR /app
# O coletor importa o contrato e a normalização do CRM: o contexto do build é a raiz do crmflash.
COPY src/lib/whatsapp/contract.ts src/lib/whatsapp/contract.ts
COPY src/lib/identity/normalize.ts src/lib/identity/normalize.ts
COPY collectors/whatsapp/package.json collectors/whatsapp/package-lock.json collectors/whatsapp/
RUN cd collectors/whatsapp && npm ci
COPY collectors/whatsapp/ collectors/whatsapp/
WORKDIR /app/collectors/whatsapp
ENV WA_SESSION_PATH=/data/session WA_STATE_PATH=/data/state.json
CMD ["npx", "tsx", "src/index.ts"]
```

Para `normalize.ts` achar `libphonenumber-js` dentro do contêiner, o Node resolve a partir de `/app/src/lib/identity/`, sobe até `/app/node_modules` e não acha. Registrar no README que, na opção B, é preciso um `package.json` mínimo em `/app` com `libphonenumber-js` ou um `NODE_PATH=/app/collectors/whatsapp/node_modules`. Usar `ENV NODE_PATH=/app/collectors/whatsapp/node_modules` no Dockerfile. No PC isso não aparece, porque `normalize.ts` resolve pelo `node_modules` da raiz do crmflash. Por isso o README também manda rodar `npm install` na raiz.

`README.md`: o que é; só leitura e o que nunca sai do PC; instalação (`npm install` na raiz do crmflash e em `collectors/whatsapp`; `node scripts/whatsapp-collector-token.mjs`; preencher `.env`); parear (`npm start`, abrir `http://localhost:3011`, WhatsApp → Dispositivos conectados → Conectar); deixar ligado com pm2 (`pm2 start ecosystem.config.cjs && pm2 save`) ou pelo `start-hidden.vbs` na pasta Inicializar (`shell:startup`); como resolver a fila no claude.ai; opção B com o Dockerfile e o `NODE_PATH`.

`docs/memory.md`: entrada "Fase 4 — WhatsApp (23/10/2026)" com a decisão (leitor local, só leitura, nada pessoal sai do PC), os três endpoints, a migração 025, as envs e o risco aceito (biblioteca não oficial).

- [ ] **Step 6: Instalar, typecheck e testes**

Run:
```bash
cd collectors/whatsapp && npm install && npx tsc --noEmit && cd ../.. && npx vitest run && npx tsc --noEmit && npx eslint .
```
Expected: tudo verde. A suíte da raiz inclui os testes do coletor.

- [ ] **Step 7: Commit**

```bash
git add collectors/whatsapp docs/memory.md
git commit -m "feat(coletor-wa): leitor só leitura, painel local e operação no PC"
```

---

### Task 11: Rollout (com o Gabriel, passo a passo)

Nada aqui é código. Cada passo é dado a ele, e ele avisa quando terminar.

- [ ] **Step 1: PR**

```bash
git push -u origin feat/hub-fase4-whatsapp
gh pr create -R gmonteiro/crmflash --title "feat(hub): fase 4 — WhatsApp leitor local, só leitura" --body "<resumo + Closes nada + 🤖 Generated with [Claude Code](https://claude.com/claude-code)>"
```

- [ ] **Step 2: Migração 025** — copiar para a área de transferência e o Gabriel roda no SQL Editor do CRM. Conferência: `select count(*) from information_schema.tables where table_name='whatsapp_group_companies';` → 1.

- [ ] **Step 3: Token** — o Gabriel roda `! node scripts/whatsapp-collector-token.mjs` (na raiz do worktree). O token vai para `collectors/whatsapp/.env`; a tela mostra só o hash.

- [ ] **Step 4: Env na Vercel** — o Gabriel roda `! vercel env add WHATSAPP_COLLECTOR_TOKEN_SHA256 production` e cola o hash. Ele também completa o `.env` do coletor com `WHATSAPP_INTERNAL_PHONES` (telefones da Lumeis).

- [ ] **Step 5: Merge** — `! gh pr merge <n> -R gmonteiro/crmflash --merge`. Esperar o deploy: `GET /api/hub/whatsapp/directory` sem token responde 401.

- [ ] **Step 6: Parear** — o Gabriel roda `! cd collectors/whatsapp && npm install && npm start`, abre `http://localhost:3011` e escaneia o QR.

- [ ] **Step 7: Verificar o primeiro ciclo** — o log mostra `N vinculadas, M candidatas novas`. Na primeira vez, vinculadas = 0 (não há telefone confirmado). Conferir no banco:
  - `identity_reviews` abertos com `reason in ('whatsapp_contato','grupo_sem_empresa')`, e que `observed` tem só `source`, `phone`/`name` ou `group_id`/`group_name`;
  - `activities` com `source='whatsapp'` = 0.

- [ ] **Step 8: Resolver a fila** — o Gabriel resolve os casos no claude.ai (`list_identity_reviews` / `resolve_identity`). No ciclo seguinte (até 5 min), conferir:
  - `activities` com `source='whatsapp'` > 0, só das conversas confirmadas;
  - `received` com `client_engaged = true` e `sent` com `false`;
  - o `last_client_event_at` das contas mexeu só para a frente;
  - `sync_cursors` com `source='whatsapp', key='heartbeat'` recente.

- [ ] **Step 9: Deixar ligado** — `pm2 start ecosystem.config.cjs && pm2 save`, ou o `start-hidden.vbs` em `shell:startup`. Reiniciar o PC uma vez e conferir que o painel volta conectado, sem QR.

- [ ] **Step 10: Atualizar a memória e o checklist** — memória `ecossistema-comercial-lead.md` (D2 resolvido, fase 4 no ar) e o artefato do checklist.
