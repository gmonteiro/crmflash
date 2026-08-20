# CRMFlash Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o CRMFlash de single-tenant por usuário em workspace de time, para que duas pessoas operem um único funil comercial.

**Architecture:** Migração aditiva. Cada uma das 13 tabelas com `user_id` ganha um `workspace_id`; as ~59 policies de RLS passam a comparar com `current_workspace()`, uma função `SECURITY DEFINER` sem parâmetros que resolve o workspace do `auth.uid()`. O `user_id` permanece e muda de significado — de posse para autoria. Um `DEFAULT current_workspace()` em cada tabela mantém o código antigo funcionando entre o deploy do schema e o do código, tornando as duas fases independentes.

**Tech Stack:** Next.js 16.1.6 (App Router), React 19, Supabase (Postgres + RLS + Storage), TypeScript, vitest 4, shadcn/ui, Tailwind 4.

## Global Constraints

- **Só existe o banco de produção.** Não há `supabase/config.toml`, stack local ou staging. Migrations são aplicadas à mão no SQL editor do Supabase. Toda migration roda dentro de `begin; ... commit;`.
- **Volume atual:** 3.058 empresas, 4.278 pessoas, 145 shortlist_members, 80 company_activities, 77 company_next_steps, 48 copilot_question_events, 10 kanban_columns, 9 activities, 9 import_history, 9 company_commitment_signals, 20 company_stage_events, 0 tags, 0 company_documents.
- **Um único usuário cadastrado:** `gq.monteiro@gmail.com` = `cbbf2f94-604f-4a99-ad04-c49949696aac`. É também o valor de `INTEGRATION_USER_ID`.
- **As 13 tabelas com `user_id`:** `companies`, `people`, `kanban_columns`, `tags`, `shortlists`, `activities`, `import_history`, `company_documents`, `company_activities`, `company_next_steps`, `company_commitment_signals`, `company_stage_events`, `copilot_question_events`.
- **As 2 tabelas sem `user_id`** (escopadas pelo pai, não mudam de coluna): `people_tags`, `shortlist_members`.
- **Sem novas dependências.** Scripts são `.mjs` rodados com `node --env-file=.env.local` (Node 24 no ambiente).
- **vitest cobre só lógica pura** (`src/**/*.test.ts`, environment node). Não há jsdom nem testing-library — componentes não são testados.
- **Nada muda no TranscriptionApp.** Mesma env var `INTEGRATION_USER_ID`, mesmo secret, mesmo payload.
- Spec de referência: `docs/superpowers/specs/2026-08-20-crmflash-workspaces-design.md`.

---

## File Structure

**Fase 1 — banco**

| Arquivo | Responsabilidade |
|---|---|
| `scripts/backup-tables.mjs` (criar) | Dump JSON das 15 tabelas via REST + service role. Rede de segurança antes da migration |
| `scripts/verify-workspace-rls.mjs` (criar) | O teste da fase 1: dois usuários descartáveis, afirma isolamento nas 15 tabelas |
| `supabase/migrations/010_workspaces.sql` (criar) | A migration inteira, em uma transação |
| `supabase/migrations/010_workspaces_rollback.sql` (criar) | Desfaz a 010 restaurando as policies antigas |

**Fase 2 — código**

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/workspace/context.tsx` (criar) | `WorkspaceProvider` + `useWorkspace()`. Única fonte do `workspaceId` no cliente |
| `src/hooks/use-workspace-members.ts` (criar) | Membros, convites, aceitar/recusar, sair |
| `src/components/settings/workspace-card.tsx` (criar) | UI de membros e convites dentro de `/settings` |
| `src/app/invite/page.tsx` (criar) | Tela de convite pendente no primeiro login |
| `src/app/(dashboard)/layout.tsx` (modificar) | Envolve com `WorkspaceProvider`; bootstrap passa a ser por workspace |
| `src/hooks/use-*.ts` (modificar, 9 arquivos) | `.eq("user_id")` → `.eq("workspace_id")`; inserts carregam os dois |
| `src/lib/auth/integration.ts` (modificar) | Devolve `{ userId, workspaceId }` |
| `src/app/api/integration/**` (modificar, 3 rotas) | Escopo por workspace |
| `src/app/api/enrich/**`, `src/app/api/copilot/interpret` (modificar) | Escopo por workspace |
| `src/types/database.ts` (modificar) | `workspace_id` nos tipos; tipos de workspace |

---

# FASE 1 — BANCO

### Task 1: Backup das 15 tabelas

Antes de tocar em qualquer coisa. Sem staging, este dump é o único rollback real para os dados.

**Files:**
- Create: `scripts/backup-tables.mjs`

**Interfaces:**
- Consumes: nada
- Produces: arquivos `backup/<timestamp>/<tabela>.json`

- [ ] **Step 1: Escrever o script**

```javascript
// scripts/backup-tables.mjs
// Dump completo das tabelas via PostgREST com service role.
// Rode com: node --env-file=.env.local scripts/backup-tables.mjs
import { mkdirSync, writeFileSync } from "node:fs"

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) throw new Error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")

const TABLES = [
  "companies", "people", "kanban_columns", "tags", "shortlists", "activities",
  "import_history", "company_documents", "company_activities", "company_next_steps",
  "company_commitment_signals", "company_stage_events", "copilot_question_events",
  "people_tags", "shortlist_members",
]

const PAGE = 1000

async function dump(table) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${URL}/rest/v1/${table}?select=*`, {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        Range: `${from}-${from + PAGE - 1}`,
      },
    })
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`)
    const batch = await res.json()
    rows.push(...batch)
    if (batch.length < PAGE) break
  }
  return rows
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-")
const dir = `backup/${stamp}`
mkdirSync(dir, { recursive: true })

for (const table of TABLES) {
  const rows = await dump(table)
  writeFileSync(`${dir}/${table}.json`, JSON.stringify(rows, null, 2))
  console.log(`${table}: ${rows.length} linhas`)
}
console.log(`\nBackup em ${dir}`)
```

- [ ] **Step 2: Ignorar os dumps no git**

Adicionar ao `.gitignore`:

```
backup/
```

O dump tem dados de 4.278 pessoas reais e o repositório é **público**. Sem esta linha, o próximo `git add -A` vaza a base inteira.

- [ ] **Step 3: Rodar**

```bash
node --env-file=.env.local scripts/backup-tables.mjs
```

Esperado: 15 linhas de contagem, batendo com os números em "Global Constraints" (3058 companies, 4278 people, …).

- [ ] **Step 4: Commit**

```bash
git add scripts/backup-tables.mjs .gitignore
git commit -m "chore: script de backup das tabelas antes da migração de workspaces"
```

---

### Task 2: O teste de isolamento (escrito antes da migration)

Este é o "write the failing test" da fase 1. Ele falha agora porque `workspaces` não existe, e passa depois da Task 4.

**Files:**
- Create: `scripts/verify-workspace-rls.mjs`

**Interfaces:**
- Consumes: nada
- Produces: exit code 0 (tudo isolado) ou 1 com a lista de falhas

- [ ] **Step 1: Escrever o script**

```javascript
// scripts/verify-workspace-rls.mjs
// Cria dois usuários descartáveis — um DENTRO do workspace existente, um FORA —
// e afirma, para cada tabela, que o de dentro lê e o de fora não lê nada.
// Rode com: node --env-file=.env.local scripts/verify-workspace-rls.mjs
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!URL || !SERVICE || !ANON) throw new Error("Faltam variáveis do Supabase em .env.local")

const TABLES = [
  "companies", "people", "kanban_columns", "tags", "shortlists", "activities",
  "import_history", "company_documents", "company_activities", "company_next_steps",
  "company_commitment_signals", "company_stage_events", "copilot_question_events",
  "people_tags", "shortlist_members",
]

const admin = (path, init = {}) =>
  fetch(`${URL}${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...init.headers },
  })

const asUser = (token, path) =>
  fetch(`${URL}${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } })

async function createUser(email) {
  const password = `Test-${Math.random().toString(36).slice(2)}-Aa1!`
  const res = await admin("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  if (!res.ok) throw new Error(`createUser ${email}: ${await res.text()}`)
  const user = await res.json()

  const login = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  if (!login.ok) throw new Error(`login ${email}: ${await login.text()}`)
  const { access_token } = await login.json()
  return { id: user.id, token: access_token }
}

const deleteUser = (id) => admin(`/auth/v1/admin/users/${id}`, { method: "DELETE" })

async function count(token, table) {
  const res = await asUser(token, `/rest/v1/${table}?select=*&limit=1000`)
  if (!res.ok) return { error: `HTTP ${res.status}` }
  return { rows: (await res.json()).length }
}

const failures = []
const check = (label, ok, detail) => {
  console.log(`${ok ? "  ok  " : "FAIL  "} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures.push(label)
}

// --- setup -----------------------------------------------------------------
const suffix = Math.random().toString(36).slice(2, 8)
const insider = await createUser(`rls-in-${suffix}@example.com`)
const outsider = await createUser(`rls-out-${suffix}@example.com`)

try {
  // O workspace com os dados reais é o mais antigo.
  const wsRes = await admin("/rest/v1/workspaces?select=id&order=created_at.asc&limit=1")
  const [ws] = await wsRes.json()
  if (!ws) throw new Error("Nenhum workspace encontrado — a migration 010 rodou?")

  // O insider entra nesse workspace. O outsider fica sem workspace nenhum.
  const join = await admin("/rest/v1/workspace_members", {
    method: "POST",
    body: JSON.stringify({ workspace_id: ws.id, user_id: insider.id }),
  })
  if (!join.ok) throw new Error(`join: ${await join.text()}`)

  console.log("\n== insider (membro do workspace) deve LER ==")
  for (const table of TABLES) {
    const { rows, error } = await count(insider.token, table)
    check(`insider lê ${table}`, error === undefined, error ?? `${rows} linhas`)
  }

  console.log("\n== outsider (sem workspace) NÃO deve ler nada ==")
  for (const table of TABLES) {
    const { rows, error } = await count(outsider.token, table)
    check(`outsider bloqueado em ${table}`, error !== undefined || rows === 0, error ?? `${rows} linhas VAZARAM`)
  }

  console.log("\n== outsider não deve conseguir escrever ==")
  const write = await fetch(`${URL}/rest/v1/companies`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${outsider.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "empresa-invasora" }),
  })
  check("outsider bloqueado ao inserir company", !write.ok, `HTTP ${write.status}`)

  console.log("\n== guarda do último membro ==")
  const delSelf = await fetch(`${URL}/rest/v1/workspace_members?user_id=eq.${insider.id}`, {
    method: "DELETE",
    headers: { apikey: ANON, Authorization: `Bearer ${insider.token}` },
  })
  check("insider consegue sair (não é o último)", delSelf.ok, `HTTP ${delSelf.status}`)
} finally {
  await deleteUser(insider.id)
  await deleteUser(outsider.id)
  console.log("\nusuários de teste removidos")
}

if (failures.length) {
  console.error(`\n${failures.length} falha(s):\n  ${failures.join("\n  ")}`)
  process.exit(1)
}
console.log("\nTudo isolado.")
```

- [ ] **Step 2: Rodar para confirmar que falha**

```bash
node --env-file=.env.local scripts/verify-workspace-rls.mjs
```

Esperado: erro `Nenhum workspace encontrado — a migration 010 rodou?`, porque a tabela `workspaces` ainda não existe. É a falha correta: o teste está medindo a coisa certa.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-workspace-rls.mjs
git commit -m "test: script de verificação de isolamento por workspace (falha até a 010 rodar)"
```

---

### Task 3: Escrever a migration 010 e o rollback

**Files:**
- Create: `supabase/migrations/010_workspaces.sql`
- Create: `supabase/migrations/010_workspaces_rollback.sql`

**Interfaces:**
- Consumes: schema atual (15 tabelas, ~59 policies, 2 policies de storage)
- Produces: `workspaces`, `workspace_members`, `workspace_invitations`, `current_workspace()`, `default_workspace()`, coluna `workspace_id` nas 13 tabelas, `create_default_kanban_columns(p_workspace_id uuid)`

> **Correções aplicadas durante a execução.** O SQL abaixo foi o rascunho; o
> arquivo commitado em `supabase/migrations/010_workspaces.sql` é a verdade.
> Três diferenças, todas encontradas pelos passos de conferência desta task:
>
> 1. **Títulos das colunas do kanban.** O rascunho inventou "Contato Iniciado /
>    Conversa Ativa / Dor Confirmada / Proposta / Negociação". Os reais, da
>    `008_kanban_pipeline.sql`, são "Contato / Diagnóstico / Dor validada /
>    Solução desenhada / Prova / Aprovação".
> 2. **`default_workspace()` em vez de `current_workspace()` no DEFAULT.** As
>    rotas `/api/integration/*` escrevem com **service role**, onde `auth.uid()`
>    é nulo — o DEFAULT viraria NULL e todo "Enviar ao CRM" do TranscriptionApp
>    quebraria entre os dois deploys. `default_workspace()` cai para o workspace
>    único quando `auth.uid()` não resolve, e devolve NULL (falhando alto)
>    assim que existir mais de um.
> 3. **Lookup da foreign key.** Casava por nome (`conname like '%user_id%'`) e
>    pulava calado se não achasse, deixando o `ON DELETE CASCADE` no lugar.
>    Agora casa por coluna e tabela referenciada, e `raise exception` se não
>    encontrar.

- [ ] **Step 1: Escrever a migration**

```sql
-- 010_workspaces.sql
-- Transforma o CRM de single-tenant por usuário em workspace de time.
-- Ver docs/superpowers/specs/2026-08-20-crmflash-workspaces-design.md
--
-- RODAR INTEIRA, DE UMA VEZ, NO SQL EDITOR DO SUPABASE.
-- O begin/commit garante tudo-ou-nada: se qualquer passo falhar, nada muda.

begin;

-- ---------------------------------------------------------------------------
-- 1. Tabelas de workspace
-- ---------------------------------------------------------------------------
create table workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table workspace_members (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  joined_at    timestamptz not null default now(),
  -- unique no user_id (e não no par): é isto que torna "um workspace por
  -- pessoa" invariante de banco em vez de regra que o código precisa lembrar.
  unique (user_id)
);

create table workspace_invitations (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  invited_email text not null,
  invited_by    uuid not null references auth.users(id),
  status        text not null default 'pending'
                check (status in ('pending','accepted','declined')),
  created_at    timestamptz not null default now(),
  unique (workspace_id, invited_email)
);

create index idx_workspace_members_ws on workspace_members(workspace_id);
create index idx_workspace_invitations_email on workspace_invitations(lower(invited_email));

-- ---------------------------------------------------------------------------
-- 2. current_workspace()
--
-- SECURITY DEFINER de propósito: ela lê workspace_members, que tem RLS que por
-- sua vez chama current_workspace(). Sem DEFINER isso seria recursão infinita.
-- Sem parâmetro: não há como pedir o workspace de outra pessoa — o buraco que a
-- migration 005 teve que tapar em create_default_kanban_columns.
-- ---------------------------------------------------------------------------
create or replace function current_workspace()
returns uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select workspace_id from workspace_members where user_id = auth.uid();
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Guarda: não esvaziar o workspace
--
-- Vai num trigger, não numa policy: policy de DELETE não consegue contar as
-- linhas restantes, e validar só no cliente deixa a regra contornável por
-- chamada direta ao PostgREST.
-- ---------------------------------------------------------------------------
create or replace function prevent_last_member_removal()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if (select count(*) from workspace_members where workspace_id = old.workspace_id) <= 1 then
    raise exception 'Nao e possivel remover o ultimo membro do workspace';
  end if;
  return old;
end;
$fn$;

create trigger workspace_members_prevent_last
  before delete on workspace_members
  for each row execute function prevent_last_member_removal();

-- ---------------------------------------------------------------------------
-- 4. RLS das tabelas de workspace
-- ---------------------------------------------------------------------------
alter table workspaces            enable row level security;
alter table workspace_members     enable row level security;
alter table workspace_invitations enable row level security;

create policy workspaces_select on workspaces for select
  using (id = current_workspace());

-- Só quem ainda não tem workspace pode criar um: é o bootstrap do primeiro
-- login, e impede que quem já é membro crie um segundo.
create policy workspaces_insert on workspaces for insert
  with check (current_workspace() is null and created_by = auth.uid());

create policy workspaces_update on workspaces for update
  using (id = current_workspace()) with check (id = current_workspace());

create policy workspace_members_select on workspace_members for select
  using (workspace_id = current_workspace());

-- Dois caminhos, e nenhum deles pode usar current_workspace(): quem está
-- entrando ainda não é membro, então a função retorna null pra ele.
create policy workspace_members_insert on workspace_members for insert
  with check (
    user_id = auth.uid()
    and (
      -- (a) bootstrap: acabei de criar este workspace
      exists (
        select 1 from workspaces w
        where w.id = workspace_members.workspace_id and w.created_by = auth.uid()
      )
      -- (b) aceite de convite pendente pro meu e-mail
      or exists (
        select 1 from workspace_invitations i
        where i.workspace_id = workspace_members.workspace_id
          and lower(i.invited_email) = lower(auth.jwt() ->> 'email')
          and i.status = 'pending'
      )
    )
  );

-- Modelo plano: qualquer membro remove qualquer um (o trigger acima impede
-- que isso esvazie o workspace).
create policy workspace_members_delete on workspace_members for delete
  using (workspace_id = current_workspace());

create policy workspace_invitations_select on workspace_invitations for select
  using (
    workspace_id = current_workspace()
    or lower(invited_email) = lower(auth.jwt() ->> 'email')
  );

create policy workspace_invitations_insert on workspace_invitations for insert
  with check (workspace_id = current_workspace() and invited_by = auth.uid());

create policy workspace_invitations_update on workspace_invitations for update
  using (lower(invited_email) = lower(auth.jwt() ->> 'email'))
  with check (lower(invited_email) = lower(auth.jwt() ->> 'email'));

create policy workspace_invitations_delete on workspace_invitations for delete
  using (workspace_id = current_workspace());

-- ---------------------------------------------------------------------------
-- 5. Um workspace por usuário existente (hoje: exatamente um)
-- ---------------------------------------------------------------------------
do $mig$
declare u record; ws uuid;
begin
  for u in select id, email from auth.users loop
    insert into workspaces (name, created_by)
    values (coalesce(nullif(split_part(u.email, '@', 1), ''), 'Workspace'), u.id)
    returning id into ws;

    insert into workspace_members (workspace_id, user_id) values (ws, u.id);
  end loop;
end
$mig$;

-- ---------------------------------------------------------------------------
-- 6. workspace_id nas 13 tabelas + user_id vira autoria
--
-- Em loop porque são 13 tabelas com exatamente o mesmo tratamento; escrito à
-- mão, 13 blocos quase idênticos é onde erro de copiar-colar mora.
-- ---------------------------------------------------------------------------
do $mig$
declare
  t text;
  fk text;
  tables text[] := array[
    'companies', 'people', 'kanban_columns', 'tags', 'shortlists', 'activities',
    'import_history', 'company_documents', 'company_activities',
    'company_next_steps', 'company_commitment_signals', 'company_stage_events',
    'copilot_question_events'
  ];
begin
  foreach t in array tables loop
    execute format(
      'alter table %I add column workspace_id uuid references workspaces(id) on delete cascade', t);

    execute format(
      'update %I x set workspace_id = m.workspace_id from workspace_members m where m.user_id = x.user_id', t);

    execute format('alter table %I alter column workspace_id set not null', t);

    -- O DEFAULT é o que mantém o código antigo funcionando entre os dois
    -- deploys: insert sem workspace_id cai no workspace certo em vez de
    -- estourar NOT NULL. Fica como rede permanente.
    execute format(
      'alter table %I alter column workspace_id set default current_workspace()', t);

    execute format('create index on %I (workspace_id)', t);

    -- user_id passa a ser autoria: nullable, e SET NULL em vez de CASCADE.
    -- Sem isso, apagar a conta de um membro apagaria em cascata tudo que ele
    -- criou — que agora é dado do workspace, não dele.
    execute format('alter table %I alter column user_id drop not null', t);

    select conname into fk
    from pg_constraint
    where conrelid = format('public.%I', t)::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like '%auth.users%'
      and conname like '%user_id%';

    if fk is not null then
      execute format('alter table %I drop constraint %I', t, fk);
      execute format(
        'alter table %I add constraint %I foreign key (user_id) references auth.users(id) on delete set null',
        t, fk);
    end if;

    execute format(
      'comment on column %I.user_id is %L', t,
      'Quem criou esta linha. NAO e escopo de acesso -- use workspace_id.');
  end loop;
end
$mig$;

-- Índices antigos por user_id: agora apontam pra coluna errada e só custam
-- escrita. Com 3.058 empresas e 4.278 pessoas isso pesa em toda listagem.
drop index if exists idx_companies_user_id;
drop index if exists idx_people_user_id;
drop index if exists idx_kanban_columns_user_id;
drop index if exists idx_tags_user_id;

-- Dedup da importação: por workspace, senão as duas importam a mesma planilha
-- e o CRM aceita as duplicatas caladas.
drop index if exists idx_people_dedup;
create unique index idx_people_dedup on people (
  workspace_id,
  lower(trim(first_name)),
  lower(trim(last_name)),
  lower(trim(coalesce(current_title, ''))),
  lower(trim(coalesce(current_company, '')))
);

-- ---------------------------------------------------------------------------
-- 7. Policies das 13 tabelas: tudo vira workspace_id = current_workspace()
-- ---------------------------------------------------------------------------
do $mig$
declare
  t text;
  p record;
  tables text[] := array[
    'companies', 'people', 'kanban_columns', 'tags', 'shortlists', 'activities',
    'import_history', 'company_documents', 'company_activities',
    'company_next_steps', 'company_commitment_signals', 'company_stage_events',
    'copilot_question_events'
  ];
begin
  foreach t in array tables loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on %I', p.policyname, t);
    end loop;

    execute format('create policy %I on %I for select using (workspace_id = current_workspace())', t || '_ws_select', t);
    execute format('create policy %I on %I for insert with check (workspace_id = current_workspace())', t || '_ws_insert', t);
    execute format('create policy %I on %I for update using (workspace_id = current_workspace()) with check (workspace_id = current_workspace())', t || '_ws_update', t);
    execute format('create policy %I on %I for delete using (workspace_id = current_workspace())', t || '_ws_delete', t);
  end loop;
end
$mig$;

-- ---------------------------------------------------------------------------
-- 8. As 2 filhas: continuam escopadas pelo pai, agora via workspace
-- ---------------------------------------------------------------------------
do $mig$
declare p record;
begin
  for p in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename in ('people_tags', 'shortlist_members') loop
    execute format('drop policy %I on %I', p.policyname, p.tablename);
  end loop;
end
$mig$;

create policy people_tags_ws_all on people_tags for all
  using (exists (select 1 from people p where p.id = people_tags.person_id and p.workspace_id = current_workspace()))
  with check (exists (select 1 from people p where p.id = people_tags.person_id and p.workspace_id = current_workspace()));

create policy shortlist_members_ws_all on shortlist_members for all
  using (exists (select 1 from shortlists s where s.id = shortlist_members.shortlist_id and s.workspace_id = current_workspace()))
  with check (exists (select 1 from shortlists s where s.id = shortlist_members.shortlist_id and s.workspace_id = current_workspace()));

-- ---------------------------------------------------------------------------
-- 9. Storage: a pasta continua sendo o user_id de quem subiu; muda quem pode ler
-- ---------------------------------------------------------------------------
do $mig$
declare p record;
begin
  for p in select policyname from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
             and qual like '%company-documents%' loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end
$mig$;

create policy company_documents_ws_all on storage.objects for all
  using (
    bucket_id = 'company-documents'
    and (storage.foldername(name))[1]::uuid in (
      select user_id from workspace_members where workspace_id = current_workspace()
    )
  )
  with check (
    bucket_id = 'company-documents'
    and (storage.foldername(name))[1]::uuid in (
      select user_id from workspace_members where workspace_id = current_workspace()
    )
  );

-- ---------------------------------------------------------------------------
-- 10. Colunas padrão do kanban: por workspace, não por usuário
--
-- Sem isto a segunda pessoa a logar criaria um segundo conjunto de 10 colunas
-- em cima do quadro que já existe.
-- ---------------------------------------------------------------------------
drop function if exists create_default_kanban_columns(uuid);

create or replace function create_default_kanban_columns(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- Mesmo guard da migration 005, agora por workspace.
  if p_workspace_id is distinct from current_workspace() then
    raise exception 'Cannot create kanban columns for another workspace';
  end if;

  insert into kanban_columns (workspace_id, title, color, position) values
    (p_workspace_id, 'Alvos',              '#64748b',  1),
    (p_workspace_id, 'Contato Iniciado',   '#6366f1',  2),
    (p_workspace_id, 'Conversa Ativa',     '#8b5cf6',  3),
    (p_workspace_id, 'Dor Confirmada',     '#3b82f6',  4),
    (p_workspace_id, 'Diagnóstico',        '#0ea5e9',  5),
    (p_workspace_id, 'Proposta',           '#f59e0b',  6),
    (p_workspace_id, 'Negociação',         '#f97316',  7),
    (p_workspace_id, 'Ganho',              '#10b981',  8),
    (p_workspace_id, 'Perdido',            '#ef4444',  9),
    (p_workspace_id, 'Gelado',             '#94a3b8', 10);
end;
$fn$;

commit;
```

> **Antes de rodar:** confirme que os títulos e cores das 10 colunas no passo 10 batem com os da migration `008_kanban_pipeline.sql`. Se divergirem, use os da 008 — são os que estão em produção e a divergência só apareceria quando alguém criasse um workspace novo, meses depois.

- [ ] **Step 2: Escrever o rollback**

```sql
-- 010_workspaces_rollback.sql
-- Desfaz a 010. Os dados não se moveram: só a coluna workspace_id e as policies
-- mudaram, então voltar é restaurar o escopo por user_id e dropar a coluna.
--
-- NÃO restaura o user_id das linhas cujo autor tenha sido apagado depois da 010
-- (ficaram NULL por ON DELETE SET NULL). Se isso tiver acontecido, restaure do
-- backup da Task 1 antes.

begin;

do $rb$
declare
  t text;
  p record;
  tables text[] := array[
    'companies', 'people', 'kanban_columns', 'tags', 'shortlists', 'activities',
    'import_history', 'company_documents', 'company_activities',
    'company_next_steps', 'company_commitment_signals', 'company_stage_events',
    'copilot_question_events'
  ];
begin
  foreach t in array tables loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on %I', p.policyname, t);
    end loop;

    execute format('create policy %I on %I for select using (user_id = auth.uid())', t || '_select', t);
    execute format('create policy %I on %I for insert with check (user_id = auth.uid())', t || '_insert', t);
    execute format('create policy %I on %I for update using (user_id = auth.uid())', t || '_update', t);
    execute format('create policy %I on %I for delete using (user_id = auth.uid())', t || '_delete', t);

    execute format('alter table %I drop column workspace_id', t);
    execute format('alter table %I alter column user_id set not null', t);
  end loop;
end
$rb$;

drop policy if exists people_tags_ws_all on people_tags;
create policy people_tags_all on people_tags for all
  using (exists (select 1 from people where people.id = person_id and people.user_id = auth.uid()));

drop policy if exists shortlist_members_ws_all on shortlist_members;
create policy shortlist_members_all on shortlist_members for all
  using (exists (select 1 from shortlists where shortlists.id = shortlist_id and shortlists.user_id = auth.uid()));

drop policy if exists company_documents_ws_all on storage.objects;
create policy company_documents_own on storage.objects for all
  using (bucket_id = 'company-documents' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'company-documents' and (storage.foldername(name))[1] = auth.uid()::text);

drop index if exists idx_people_dedup;
create unique index idx_people_dedup on people (
  user_id,
  lower(trim(first_name)),
  lower(trim(last_name)),
  lower(trim(coalesce(current_title, ''))),
  lower(trim(coalesce(current_company, '')))
);

drop trigger if exists workspace_members_prevent_last on workspace_members;
drop function if exists prevent_last_member_removal();
drop table if exists workspace_invitations;
drop table if exists workspace_members;
drop table if exists workspaces;
drop function if exists current_workspace();

drop function if exists create_default_kanban_columns(uuid);
create or replace function create_default_kanban_columns(p_user_id uuid)
returns void language plpgsql security definer as $fn$
begin
  if p_user_id != auth.uid() then
    raise exception 'Cannot create kanban columns for another user';
  end if;
  insert into kanban_columns (user_id, title, color, position) values
    (p_user_id, 'Alvos', '#64748b', 1);
end;
$fn$;

commit;
```

> O rollback recria `create_default_kanban_columns` com **uma** coluna, não dez: ele existe para destravar um rollback de emergência, não para reproduzir o estado de onboarding. Se o rollback for usado, recrie a função a partir da `008_kanban_pipeline.sql`.

- [ ] **Step 3: Conferir o `idx_people_dedup` contra o real**

O índice recriado nos dois arquivos precisa bater com o de `006_people_unique_constraint.sql`. Abra a 006 e compare coluna a coluna:

```bash
sed -n '1,40p' supabase/migrations/006_people_unique_constraint.sql
```

Se as expressões diferirem, use as da 006 nos dois arquivos. Um dedup diferente do atual deixa passar duplicata em produção sem erro nenhum.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/010_workspaces.sql supabase/migrations/010_workspaces_rollback.sql
git commit -m "feat(db): migration de workspaces compartilhados"
```

---

### Task 4: Aplicar a migration e verificar

**Files:**
- Nenhum. Esta task roda SQL e o verificador.

**Interfaces:**
- Consumes: `010_workspaces.sql`, `scripts/verify-workspace-rls.mjs`
- Produces: banco migrado; `verify-workspace-rls.mjs` passando

- [ ] **Step 1: Confirmar que o backup da Task 1 existe**

```bash
ls backup/
```

Esperado: pelo menos um diretório com 15 arquivos `.json`. **Se não houver, pare e rode a Task 1.** Não há staging: este é o único caminho de volta para os dados.

- [ ] **Step 2: Aplicar**

Abrir o SQL editor do Supabase, colar o conteúdo inteiro de `supabase/migrations/010_workspaces.sql` e executar. Como está tudo dentro de `begin/commit`, qualquer erro aborta sem deixar estado pela metade.

Esperado: sucesso, sem linhas retornadas.

- [ ] **Step 3: Conferir o backfill**

```bash
node --env-file=.env.local -e '
const U=process.env.NEXT_PUBLIC_SUPABASE_URL, K=process.env.SUPABASE_SERVICE_ROLE_KEY
const h={apikey:K,Authorization:`Bearer ${K}`,Prefer:"count=exact",Range:"0-0"}
for (const t of ["companies","people","kanban_columns"]) {
  const r = await fetch(`${U}/rest/v1/${t}?select=id&workspace_id=is.null`,{headers:h})
  console.log(t, "sem workspace:", r.headers.get("content-range"))
}'
```

Esperado: `*/0` nas três — nenhuma linha órfã. Se alguma tiver linhas, rode o rollback e investigue antes de seguir.

- [ ] **Step 4: Rodar o verificador**

```bash
node --env-file=.env.local scripts/verify-workspace-rls.mjs
```

Esperado: todas as linhas `ok`, terminando em `Tudo isolado.` e exit 0. Em particular, **as 15 linhas de "outsider bloqueado"** — é o que prova que ninguém de fora lê o CRM.

Se qualquer linha de outsider mostrar `linhas VAZARAM`, a policy daquela tabela está errada. Rode o rollback, corrija, e volte ao Step 2.

- [ ] **Step 5: Confirmar que o app antigo continua de pé**

Abrir https://crmflash.vercel.app e navegar por `/companies`, `/kanban` e `/pipeline`. O código em produção ainda é o antigo (filtra por `user_id`), e deve funcionar exatamente como antes — é o que o `DEFAULT current_workspace()` e o backfill garantem.

Esperado: 3.058 empresas listando, kanban com as 10 colunas e os cards nos lugares.

- [ ] **Step 6: Commit**

```bash
git commit --allow-empty -m "chore(db): migration 010 aplicada em produção, isolamento verificado"
```

---

# FASE 2 — CÓDIGO

### Task 5: Tipos e `WorkspaceProvider`

**Files:**
- Create: `src/lib/workspace/context.tsx`
- Modify: `src/types/database.ts`
- Modify: `src/app/(dashboard)/layout.tsx:19-37`

**Interfaces:**
- Consumes: tabelas `workspaces` / `workspace_members`, RPC `create_default_kanban_columns(p_workspace_id)`
- Produces:
  - `type Workspace = { id: string; name: string; created_by: string; created_at: string }`
  - `type WorkspaceMember = { id: string; workspace_id: string; user_id: string; joined_at: string }`
  - `type WorkspaceInvitation = { id: string; workspace_id: string; invited_email: string; invited_by: string; status: 'pending' | 'accepted' | 'declined'; created_at: string }`
  - `<WorkspaceProvider>` (componente)
  - `useWorkspace(): { workspaceId: string | null; userId: string | null; loading: boolean }`

- [ ] **Step 1: Adicionar os tipos**

Em `src/types/database.ts`, no fim do arquivo:

```typescript
export interface Workspace {
  id: string
  name: string
  created_by: string
  created_at: string
}

export interface WorkspaceMember {
  id: string
  workspace_id: string
  user_id: string
  joined_at: string
}

export type InvitationStatus = 'pending' | 'accepted' | 'declined'

export interface WorkspaceInvitation {
  id: string
  workspace_id: string
  invited_email: string
  invited_by: string
  status: InvitationStatus
  created_at: string
}
```

- [ ] **Step 2: Adicionar `workspace_id` aos tipos existentes**

Em cada uma das 13 interfaces de `src/types/database.ts` que tem `user_id: string`, acrescentar a linha seguinte e afrouxar `user_id`:

```typescript
  workspace_id: string
  user_id: string | null   // quem criou; NÃO é escopo — use workspace_id
```

As 13 interfaces correspondem às tabelas listadas em "Global Constraints". `Company` é a primeira, na linha 5.

- [ ] **Step 3: Escrever o provider**

```tsx
// src/lib/workspace/context.tsx
"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

type WorkspaceState = {
  workspaceId: string | null
  userId: string | null
  loading: boolean
}

const WorkspaceContext = createContext<WorkspaceState>({
  workspaceId: null,
  userId: null,
  loading: true,
})

// Única fonte do workspaceId no cliente. Antes cada hook refazia auth.getUser()
// por conta própria; agora resolvem daqui.
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WorkspaceState>({
    workspaceId: null,
    userId: null,
    loading: true,
  })

  useEffect(() => {
    async function resolve() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        setState({ workspaceId: null, userId: null, loading: false })
        return
      }

      const { data: member } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", user.id)
        .maybeSingle()

      setState({
        workspaceId: member?.workspace_id ?? null,
        userId: user.id,
        loading: false,
      })
    }
    resolve()
  }, [])

  return <WorkspaceContext.Provider value={state}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  return useContext(WorkspaceContext)
}
```

- [ ] **Step 4: Ligar no layout**

Em `src/app/(dashboard)/layout.tsx`, trocar o `useEffect` das linhas 19-37 e envolver a árvore. O bootstrap muda de gatilho — de "usuário sem colunas" para "workspace sem colunas":

```tsx
"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { WorkspaceProvider, useWorkspace } from "@/lib/workspace/context"
import { Sidebar } from "@/components/layout/sidebar"
import { Topbar } from "@/components/layout/topbar"
import { cn } from "@/lib/utils"

function DashboardShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [email, setEmail] = useState<string | undefined>()
  const { workspaceId, loading } = useWorkspace()

  useEffect(() => {
    async function init() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      setEmail(user?.email ?? undefined)

      if (loading || !workspaceId) return

      const { data: cols } = await supabase
        .from("kanban_columns")
        .select("id")
        .eq("workspace_id", workspaceId)
        .limit(1)

      if (!cols || cols.length === 0) {
        await supabase.rpc("create_default_kanban_columns", { p_workspace_id: workspaceId })
      }
    }
    init()
  }, [workspaceId, loading])

  return (
    <div className="flex h-screen overflow-hidden">
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <div className="hidden md:block">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      </div>
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 md:hidden transition-transform duration-200",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <Sidebar collapsed={false} onToggle={() => setMobileOpen(false)} />
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar email={email} onMenuClick={() => setMobileOpen(!mobileOpen)} />
        <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <DashboardShell>{children}</DashboardShell>
    </WorkspaceProvider>
  )
}
```

- [ ] **Step 5: Verificar que compila**

```bash
npx tsc --noEmit
```

Esperado: erros **apenas** nos 9 hooks e nas rotas de API, reclamando de `workspace_id` faltando nos inserts. Esses são a lista de trabalho das Tasks 6 e 7 — não conserte aqui.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workspace/context.tsx src/types/database.ts "src/app/(dashboard)/layout.tsx"
git commit -m "feat: WorkspaceProvider e tipos de workspace"
```

---

### Task 6: Migrar os 9 hooks de dados

**Files:**
- Modify: `src/hooks/use-companies.ts:58,63,77,88,99,109`
- Modify: `src/hooks/use-people.ts:76,83,98,110,121,131,176,183`
- Modify: `src/hooks/use-kanban.ts:120,164,172`
- Modify: `src/hooks/use-shortlists.ts:69,74,88,98,109,118`
- Modify: `src/hooks/use-import.ts:78,85,107,144,171,195`
- Modify: `src/hooks/use-company-activities.ts:36,41,55,62`
- Modify: `src/hooks/use-company-next-steps.ts:31,36,46,68,75,88,95`
- Modify: `src/hooks/use-company-documents.ts:35,54,72,97,110`
- Modify: `src/hooks/use-company-pipeline.ts:72,79,92,99,113,124,133,150,155`

**Interfaces:**
- Consumes: `useWorkspace()` da Task 5
- Produces: nenhuma assinatura pública nova — os hooks mantêm as mesmas exportações

- [ ] **Step 1: Aplicar o mesmo padrão em cada hook**

Em todos os nove, a transformação é a mesma. Adicionar no topo do hook:

```typescript
import { useWorkspace } from "@/lib/workspace/context"
// ...dentro do hook:
const { workspaceId } = useWorkspace()
```

E depois, em cada ponto:

```typescript
// LEITURA — antes
.eq("user_id", user.id)
// LEITURA — depois
.eq("workspace_id", workspaceId)

// INSERT — antes
.insert({ ...data, user_id: user.id })
// INSERT — depois  (workspace = escopo, user = autoria)
.insert({ ...data, workspace_id: workspaceId, user_id: user.id })

// UPDATE/DELETE por id — antes
.eq("id", id).eq("user_id", user.id)
// UPDATE/DELETE por id — depois
.eq("id", id).eq("workspace_id", workspaceId)
```

O filtro explícito continua mesmo com a RLS cobrindo: é o defense-in-depth já adotado no hardening, e agora protege também contra bug de escopo.

Onde o hook só chamava `auth.getUser()` para pegar o `user.id` de escopo e não usa mais nada do usuário, remova a chamada. Onde o `user.id` ainda vai para o insert como autoria, mantenha.

- [ ] **Step 2: Verificar que compila**

```bash
npx tsc --noEmit
```

Esperado: nenhum erro vindo de `src/hooks/`. Restam os das rotas de API (Task 7).

- [ ] **Step 3: Rodar os testes existentes**

```bash
npm test
```

Esperado: PASS. Os testes cobrem `src/lib/pipeline/` (lógica pura), que não foi tocada — servem aqui como detector de regressão acidental.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/
git commit -m "feat: hooks escopados por workspace"
```

---

### Task 7: Rotas de API

**Files:**
- Modify: `src/lib/auth/integration.ts`
- Modify: `src/app/api/integration/activities/route.ts:52,65,78,107,133`
- Modify: `src/app/api/integration/activities/check/route.ts:32`
- Modify: `src/app/api/integration/search/route.ts:37,48`
- Modify: `src/app/api/enrich/route.ts`
- Modify: `src/app/api/enrich/batch/route.ts`
- Modify: `src/app/api/copilot/interpret/route.ts`

**Interfaces:**
- Consumes: tabela `workspace_members`
- Produces: `validateIntegrationAuth(request): Promise<{ userId: string; workspaceId: string } | null>` — **note que passa a ser assíncrona**

- [ ] **Step 1: Reescrever o helper de auth da integração**

```typescript
// src/lib/auth/integration.ts
import { NextRequest } from "next/server"
import { timingSafeEqual } from "crypto"
import { createClient } from "@supabase/supabase-js"

/**
 * Valida o segredo compartilhado da integração.
 * Devolve o usuário configurado e o workspace dele, ou null.
 *
 * O TranscriptionApp não muda: continua mandando o mesmo Bearer. O que muda é
 * que o destino agora é um workspace, e o INTEGRATION_USER_ID vira só a autoria.
 */
export async function validateIntegrationAuth(
  request: NextRequest
): Promise<{ userId: string; workspaceId: string } | null> {
  const secret = process.env.INTEGRATION_SECRET
  const userId = process.env.INTEGRATION_USER_ID

  if (!secret || !userId) return null

  const authHeader = request.headers.get("authorization")
  if (!authHeader) return null

  const [scheme, token] = authHeader.split(" ")
  if (scheme !== "Bearer" || !token) return null

  const tokenBuf = Buffer.from(token)
  const secretBuf = Buffer.from(secret)
  if (tokenBuf.length !== secretBuf.length || !timingSafeEqual(tokenBuf, secretBuf))
    return null

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data: member } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .maybeSingle()

  if (!member) return null

  return { userId, workspaceId: member.workspace_id }
}
```

- [ ] **Step 2: Atualizar as 3 rotas de integração**

Em cada uma, o retorno do helper muda de string para objeto e a chamada vira `await`:

```typescript
// antes
const userId = validateIntegrationAuth(request)
if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
// ... .eq('user_id', userId)  /  user_id: userId

// depois
const auth = await validateIntegrationAuth(request)
if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
const { userId, workspaceId } = auth
// leitura:  .eq('workspace_id', workspaceId)
// escrita:  { ...campos, workspace_id: workspaceId, user_id: userId }
```

- [ ] **Step 3: Atualizar enrich e copilot/interpret**

Nas três rotas restantes, trocar o escopo de leitura/escrita de `user_id` para `workspace_id`, resolvendo o workspace pelo usuário da sessão:

```typescript
const { data: { user } } = await supabase.auth.getUser()
if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

const { data: member } = await supabase
  .from("workspace_members")
  .select("workspace_id")
  .eq("user_id", user.id)
  .maybeSingle()
if (!member) return NextResponse.json({ error: "Sem workspace" }, { status: 403 })

const workspaceId = member.workspace_id
```

- [ ] **Step 4: Verificar que compila e builda**

```bash
npx tsc --noEmit && npm run build
```

Esperado: ambos sem erro.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/integration.ts src/app/api/
git commit -m "feat: rotas de API escopadas por workspace"
```

---

### Task 8: Supressão do copiloto compartilhada

O copiloto é o único lugar onde o escopo muda o **comportamento**, não só a query: se uma pessoa responde, a pergunta tem que sumir para a outra.

Os tetos (`COPILOT_DAILY_LIMIT = 6`, `COPILOT_MAX_PER_COMPANY = 4`) **não precisam de mudança**: são aplicados em `src/lib/pipeline/rules.ts:503` sobre o snapshot, e o snapshot passa a ser do workspace. Viram por workspace sozinhos.

**Files:**
- Modify: `src/hooks/use-copilot.ts:151,156,169,176,185,199,207,215,222,233,235,291,478`
- Create: `src/lib/pipeline/queue.test.ts` (já existe — acrescentar caso)

**Interfaces:**
- Consumes: `useWorkspace()`, `buildCompanyQueue(questions: CopilotQuestion[]): CompanyQueueItem[]`
- Produces: nenhuma assinatura nova

- [ ] **Step 1: Escrever o teste que documenta o teto compartilhado**

Acrescentar em `src/lib/pipeline/queue.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { buildCompanyQueue } from "./queue"
import type { CopilotQuestion } from "@/types/copilot"

describe("buildCompanyQueue com perguntas de duas pessoas", () => {
  it("agrupa por empresa independentemente de quem gerou a pendência", () => {
    // Num workspace compartilhado, as pendências das duas pessoas chegam na
    // mesma lista. A fila é por CONTA, então elas têm que colapsar num item só —
    // senão a mesma empresa apareceria duas vezes e o teto de 6 empresas/dia
    // contaria duas.
    const questions = [
      { companyId: "c1", companyName: "Acme", stageTitle: "Proposta", priority: 100, ruleId: "meeting_yesterday" },
      { companyId: "c1", companyName: "Acme", stageTitle: "Proposta", priority: 60, ruleId: "missing_champion" },
      { companyId: "c2", companyName: "Globex", stageTitle: "Alvos", priority: 40, ruleId: "missing_pain_hypothesis" },
    ] as unknown as CopilotQuestion[]

    const queue = buildCompanyQueue(questions)

    expect(queue).toHaveLength(2)
    expect(queue[0].companyId).toBe("c1")
    expect(queue[0].pendings).toHaveLength(2)
    expect(queue[0].priority).toBe(100)
    expect(queue[1].companyId).toBe("c2")
  })
})
```

- [ ] **Step 2: Rodar e ver passar**

```bash
npm test
```

Esperado: PASS. `buildCompanyQueue` já agrupa por `companyId` sem olhar autoria — o teste **documenta** e trava esse comportamento, que agora carrega significado novo. Se falhar, o agrupamento regrediu e o teto de empresas/dia está furado.

- [ ] **Step 3: Trocar o escopo da supressão**

Em `src/hooks/use-copilot.ts`, todas as consultas e escritas em `copilot_question_events` passam a usar `workspace_id`:

```typescript
// leitura da supressão — antes
.eq("user_id", userId)
// depois
.eq("workspace_id", workspaceId)

// registro do evento — antes
{ ...campos, user_id: userId }
// depois — workspace suprime pros dois; user_id diz quem respondeu
{ ...campos, workspace_id: workspaceId, user_id: userId }
```

As demais escritas do hook (linhas 156-235, que aplicam efeitos em `companies`, `company_activities`, `company_next_steps`, `company_commitment_signals`) seguem o mesmo padrão da Task 6: `workspace_id` no escopo, `user_id` na autoria.

- [ ] **Step 4: Verificar**

```bash
npx tsc --noEmit && npm test
```

Esperado: sem erro de tipo, testes passando.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-copilot.ts src/lib/pipeline/queue.test.ts
git commit -m "feat: supressão do copiloto compartilhada no workspace"
```

---

### Task 9: Membros e convites em `/settings`

**Files:**
- Create: `src/hooks/use-workspace-members.ts`
- Create: `src/components/settings/workspace-card.tsx`
- Modify: `src/app/(dashboard)/settings/page.tsx`

**Interfaces:**
- Consumes: `useWorkspace()`, tabelas `workspace_members` / `workspace_invitations`
- Produces:
  - `useWorkspaceMembers(): { members, invitations, loading, invite(email: string): Promise<void>, removeMember(userId: string): Promise<void>, cancelInvite(id: string): Promise<void>, refresh(): Promise<void> }`
  - `<WorkspaceCard />`

- [ ] **Step 1: Escrever o hook**

```typescript
// src/hooks/use-workspace-members.ts
"use client"

import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useWorkspace } from "@/lib/workspace/context"
import type { WorkspaceInvitation, WorkspaceMember } from "@/types/database"

export function useWorkspaceMembers() {
  const { workspaceId } = useWorkspace()
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const refresh = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    const [m, i] = await Promise.all([
      supabase.from("workspace_members").select("*").eq("workspace_id", workspaceId),
      supabase
        .from("workspace_invitations")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("status", "pending"),
    ])
    setMembers((m.data ?? []) as WorkspaceMember[])
    setInvitations((i.data ?? []) as WorkspaceInvitation[])
    setLoading(false)
  }, [workspaceId])

  useEffect(() => { refresh() }, [refresh])

  const invite = useCallback(async (email: string) => {
    if (!workspaceId) throw new Error("Sem workspace")
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error("Não autenticado")

    const { error } = await supabase.from("workspace_invitations").insert({
      workspace_id: workspaceId,
      invited_email: email.trim().toLowerCase(),
      invited_by: user.id,
    })
    // 23505 = unique_violation: já existe convite pendente pra este e-mail.
    if (error) throw new Error(error.code === "23505" ? "Já existe convite para este e-mail" : error.message)
    await refresh()
  }, [workspaceId, refresh])

  const removeMember = useCallback(async (userId: string) => {
    const { error } = await supabase.from("workspace_members").delete().eq("user_id", userId)
    // O trigger prevent_last_member_removal levanta exceção; o PostgREST
    // devolve a mensagem crua, que não serve pra usuário.
    if (error) throw new Error(
      error.message.includes("ultimo membro")
        ? "Não dá para remover a última pessoa do workspace"
        : error.message
    )
    await refresh()
  }, [refresh])

  const cancelInvite = useCallback(async (id: string) => {
    const { error } = await supabase.from("workspace_invitations").delete().eq("id", id)
    if (error) throw new Error(error.message)
    await refresh()
  }, [refresh])

  return { members, invitations, loading, invite, removeMember, cancelInvite, refresh }
}
```

- [ ] **Step 2: Escrever o card**

```tsx
// src/components/settings/workspace-card.tsx
"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { Users } from "lucide-react"
import { useWorkspaceMembers } from "@/hooks/use-workspace-members"
import { useWorkspace } from "@/lib/workspace/context"

export function WorkspaceCard() {
  const { userId } = useWorkspace()
  const { members, invitations, loading, invite, removeMember, cancelInvite } = useWorkspaceMembers()
  const [email, setEmail] = useState("")
  const [sending, setSending] = useState(false)

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setSending(true)
    try {
      await invite(email)
      setEmail("")
      toast.success("Convite criado. A pessoa vê ao entrar na conta dela.")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao convidar")
    } finally {
      setSending(false)
    }
  }

  async function handleRemove(id: string) {
    try {
      await removeMember(id)
      toast.success("Pessoa removida do workspace")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover")
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-4 w-4" /> Workspace
        </CardTitle>
        <CardDescription>
          Todo mundo aqui vê e edita o mesmo CRM, e pode convidar mais gente.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <ul className="space-y-2">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between text-sm">
                <span className="font-mono text-xs">{m.user_id}</span>
                <div className="flex items-center gap-2">
                  {m.user_id === userId && <Badge variant="secondary">você</Badge>}
                  {m.user_id !== userId && (
                    <Button variant="ghost" size="sm" onClick={() => handleRemove(m.user_id)}>
                      Remover
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {invitations.length > 0 && (
          <ul className="space-y-2 border-t pt-4">
            {invitations.map((i) => (
              <li key={i.id} className="flex items-center justify-between text-sm">
                <span>{i.invited_email}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">pendente</Badge>
                  <Button variant="ghost" size="sm" onClick={() => cancelInvite(i.id)}>
                    Cancelar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleInvite} className="flex gap-2 border-t pt-4">
          <Input
            type="email"
            placeholder="email@exemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" disabled={sending}>
            {sending ? "Convidando…" : "Convidar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: Montar na página de settings**

Em `src/app/(dashboard)/settings/page.tsx`, importar e renderizar o card junto dos demais:

```tsx
import { WorkspaceCard } from "@/components/settings/workspace-card"
// ...no JSX, entre os cards existentes:
<WorkspaceCard />
```

- [ ] **Step 4: Verificar**

```bash
npx tsc --noEmit && npm run build
```

Esperado: ambos sem erro.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-workspace-members.ts src/components/settings/workspace-card.tsx "src/app/(dashboard)/settings/page.tsx"
git commit -m "feat: gestão de membros e convites em /settings"
```

---

### Task 10: Aceite de convite e bootstrap do primeiro login

O caso que quebra silenciosamente se ninguém pensar nele: pessoa sem workspace loga, `current_workspace()` retorna null, todas as policies dão falso e ela vê um CRM vazio **sem erro nenhum**.

**Files:**
- Create: `src/app/invite/page.tsx`
- Modify: `src/lib/workspace/context.tsx`

**Interfaces:**
- Consumes: `useWorkspace()`, tabelas `workspaces` / `workspace_members` / `workspace_invitations`
- Produces: rota `/invite`

- [ ] **Step 1: Redirecionar quem não tem workspace**

Em `src/lib/workspace/context.tsx`, dentro de `resolve()`, depois de descobrir que `member` é nulo:

```tsx
import { useRouter } from "next/navigation"
// ...
const router = useRouter()
// ...dentro de resolve(), quando não há member:
if (!member) {
  setState({ workspaceId: null, userId: user.id, loading: false })
  router.replace("/invite")
  return
}
```

- [ ] **Step 2: Escrever a tela**

```tsx
// src/app/invite/page.tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"
import type { WorkspaceInvitation } from "@/types/database"

export default function InvitePage() {
  const router = useRouter()
  const supabase = createClient()
  const [invitation, setInvitation] = useState<WorkspaceInvitation | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace("/login"); return }

      // Já é membro? Não tem nada a fazer aqui.
      const { data: member } = await supabase
        .from("workspace_members").select("workspace_id").eq("user_id", user.id).maybeSingle()
      if (member) { router.replace("/dashboard"); return }

      // A policy de select já limita aos convites do meu e-mail.
      const { data: invite } = await supabase
        .from("workspace_invitations").select("*").eq("status", "pending").maybeSingle()

      setInvitation((invite as WorkspaceInvitation) ?? null)
      setLoading(false)
    }
    load()
  }, [])

  // Sem convite: cria workspace próprio. É o caminho de quem chegou sozinho.
  async function createOwn() {
    setWorking(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Não autenticado")

      const { data: ws, error: wsErr } = await supabase
        .from("workspaces")
        .insert({ name: user.email?.split("@")[0] ?? "Meu workspace", created_by: user.id })
        .select().single()
      if (wsErr) throw wsErr

      const { error: memErr } = await supabase
        .from("workspace_members").insert({ workspace_id: ws.id, user_id: user.id })
      if (memErr) throw memErr

      await supabase.rpc("create_default_kanban_columns", { p_workspace_id: ws.id })
      router.replace("/dashboard")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar workspace")
      setWorking(false)
    }
  }

  async function accept() {
    if (!invitation) return
    setWorking(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Não autenticado")

      const { error } = await supabase
        .from("workspace_members")
        .insert({ workspace_id: invitation.workspace_id, user_id: user.id })

      // 23505 = unique_violation no unique(user_id): esta pessoa já pertence a
      // outro workspace. Com um workspace por pessoa isso é beco sem saída — ela
      // precisa sair do atual antes. Sem esta tradução, o usuário vê o texto cru
      // da constraint e não tem como saber o que fazer.
      if (error) {
        throw new Error(
          error.code === "23505"
            ? "Você já faz parte de outro workspace. Saia dele em Configurações antes de aceitar este convite."
            : error.message
        )
      }

      await supabase
        .from("workspace_invitations").update({ status: "accepted" }).eq("id", invitation.id)

      router.replace("/dashboard")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao aceitar convite")
      setWorking(false)
    }
  }

  async function decline() {
    if (!invitation) return
    setWorking(true)
    await supabase.from("workspace_invitations").update({ status: "declined" }).eq("id", invitation.id)
    setInvitation(null)
    setWorking(false)
  }

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Carregando…</div>

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        {invitation ? (
          <>
            <CardHeader>
              <CardTitle>Você foi convidada para um CRM</CardTitle>
              <CardDescription>
                Ao aceitar, você passa a ver e editar o mesmo funil das outras pessoas do workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button onClick={accept} disabled={working}>
                {working ? "Entrando…" : "Aceitar"}
              </Button>
              <Button variant="outline" onClick={decline} disabled={working}>
                Recusar
              </Button>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle>Criar seu workspace</CardTitle>
              <CardDescription>
                Você ainda não faz parte de nenhum CRM. Crie o seu para começar.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={createOwn} disabled={working}>
                {working ? "Criando…" : "Criar workspace"}
              </Button>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: Verificar**

```bash
npx tsc --noEmit && npm run build
```

Esperado: ambos sem erro, e `/invite` aparecendo na lista de rotas do build.

- [ ] **Step 4: Commit**

```bash
git add src/app/invite/page.tsx src/lib/workspace/context.tsx
git commit -m "feat: aceite de convite e bootstrap de workspace no primeiro login"
```

---

### Task 11: Mostrar autoria onde ela muda a conversa

**Files:**
- Modify: `src/components/companies/company-timeline-tab.tsx` (lista `company_activities`)
- Modify: `src/components/companies/company-next-steps-tab.tsx` (lista `company_next_steps`)
- Modify: `src/components/companies/company-pipeline-tab.tsx` (lista `company_stage_events`)

**Interfaces:**
- Consumes: `user_id` das linhas (agora autoria), `workspace_members`
- Produces: `useMemberEmails(): Record<string, string>` — mapa `user_id` → e-mail, para rotular

- [ ] **Step 1: Escrever o mapa de e-mails**

Acrescentar em `src/hooks/use-workspace-members.ts`:

```typescript
// Rotular autoria exige e-mail, e auth.users não é legível pelo cliente.
// A alternativa seria uma tabela de perfis; enquanto o workspace é de 2-3
// pessoas, resolver sob demanda pelo RPC é mais barato que manter perfis.
export function useMemberEmails(): Record<string, string> {
  const { members } = useWorkspaceMembers()
  const [emails, setEmails] = useState<Record<string, string>>({})
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data } = await supabase.rpc("workspace_member_emails")
      if (data) {
        setEmails(Object.fromEntries(
          (data as { user_id: string; email: string }[]).map((r) => [r.user_id, r.email])
        ))
      }
    }
    if (members.length) load()
  }, [members.length])

  return emails
}
```

- [ ] **Step 2: Criar o RPC que expõe só os e-mails do próprio workspace**

Novo arquivo `supabase/migrations/011_member_emails.sql`:

```sql
-- Expor e-mail de membro sem abrir auth.users para o cliente.
-- SECURITY DEFINER, e o filtro por current_workspace() é o que impede
-- transformar isto num diretório de todos os usuários da instância.
begin;

create or replace function workspace_member_emails()
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = public
as $fn$
  select m.user_id, u.email::text
  from workspace_members m
  join auth.users u on u.id = m.user_id
  where m.workspace_id = current_workspace();
$fn$;

commit;
```

Aplicar no SQL editor do Supabase antes de seguir.

- [ ] **Step 3: Rotular nos três componentes**

Em cada um, resolver o e-mail e mostrar de forma discreta:

```tsx
const emails = useMemberEmails()
// ...no item da lista:
{item.user_id && (
  <span className="text-xs text-muted-foreground">
    {emails[item.user_id]?.split("@")[0] ?? "—"}
  </span>
)}
```

O `item.user_id` é nullable desde a Task 5 (autor pode ter saído), daí a guarda e o fallback.

- [ ] **Step 4: Verificar**

```bash
npx tsc --noEmit && npm run build
```

Esperado: ambos sem erro.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/011_member_emails.sql src/hooks/use-workspace-members.ts src/components/companies/
git commit -m "feat: autoria visível em atividades, próximos passos e histórico de estágios"
```

---

### Task 12: Verificação fim a fim e deploy

**Files:**
- Nenhum arquivo novo.

**Interfaces:**
- Consumes: tudo das Tasks 1-11

- [ ] **Step 1: Suite completa**

```bash
npm test && npx tsc --noEmit && npm run build && npx eslint src/
```

Esperado: testes PASS, sem erro de tipo, build ok. O eslint tem warnings pré-existentes de `exhaustive-deps` — o que importa é não haver **erros** novos.

- [ ] **Step 2: Reconfirmar o isolamento depois das mudanças de código**

```bash
node --env-file=.env.local scripts/verify-workspace-rls.mjs
```

Esperado: `Tudo isolado.` A Task 11 acrescentou um RPC `SECURITY DEFINER` que lê `auth.users` — rodar de novo é o que confirma que ele não abriu caminho lateral.

- [ ] **Step 3: Deploy**

```bash
git push origin master
```

O Vercel faz auto-deploy. Aguardar `● Ready`:

```bash
npx vercel ls --yes | head -5
```

- [ ] **Step 4: Passar o olho no app real**

Em https://crmflash.vercel.app, confirmar:

- `/companies` lista as 3.058 empresas
- `/kanban` mostra as 10 colunas com os cards nos lugares certos
- `/pipeline` calcula as métricas
- `/dashboard` mostra o copiloto com a fila
- `/settings` mostra o card de Workspace com você como único membro

- [ ] **Step 5: Convidar de verdade**

Em `/settings`, convidar o e-mail da outra pessoa. Ela se cadastra em `/signup`, é redirecionada para `/invite`, aceita, e cai no mesmo CRM.

Esperado: as duas veem as mesmas 3.058 empresas e o mesmo quadro de kanban. Este é o critério de aceitação do projeto inteiro.

- [ ] **Step 6: Commit final**

```bash
git commit --allow-empty -m "chore: workspaces compartilhados verificados em produção"
```

---

## Notas para quem executar

- **A Task 1 não é opcional.** Não há staging. O dump é o único caminho de volta.
- **As Tasks 4 e 11 exigem colar SQL no editor do Supabase** — não há CLI local configurada neste projeto.
- **Entre a Fase 1 e a Fase 2 o app continua funcionando** com o código antigo. Se a Fase 2 precisar parar no meio, o sistema fica num estado válido: cada pessoa vê só o que criou, ninguém vê o que não devia.
- **O repositório é público.** Nunca commitar `backup/`, `.env.local`, ou qualquer coisa com o service role key.
