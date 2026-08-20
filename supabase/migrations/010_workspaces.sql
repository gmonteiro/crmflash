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
-- 2b. default_workspace() — o DEFAULT das 13 tabelas
--
-- Não dá para usar current_workspace() direto no DEFAULT: as rotas de
-- /api/integration/* escrevem com SERVICE ROLE, onde auth.uid() é nulo. O
-- DEFAULT viraria NULL e todo "Enviar ao CRM" vindo do TranscriptionApp
-- quebraria com violação de NOT NULL entre o deploy do schema e o do código.
--
-- O fallback só vale enquanto existir EXATAMENTE um workspace. Com dois ou
-- mais devolve NULL e o insert falha alto — melhor que adivinhar destino e
-- gravar o dado de uma equipe no CRM de outra.
-- ---------------------------------------------------------------------------
create or replace function default_workspace()
returns uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(
    current_workspace(),
    (select w.id from workspaces w where (select count(*) from workspaces) = 1)
  );
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
    -- estourar NOT NULL. Ver default_workspace() acima para por que não é
    -- current_workspace() direto.
    execute format(
      'alter table %I alter column workspace_id set default default_workspace()', t);

    execute format('create index on %I (workspace_id)', t);

    -- user_id passa a ser autoria: nullable, e SET NULL em vez de CASCADE.
    -- Sem isso, apagar a conta de um membro apagaria em cascata tudo que ele
    -- criou — que agora é dado do workspace, não dele.
    execute format('alter table %I alter column user_id drop not null', t);

    -- Casa pela COLUNA e pela tabela referenciada, não pelo nome da constraint:
    -- nome é convenção, e se a convenção divergir em alguma tabela o lookup
    -- falharia calado, deixando o ON DELETE CASCADE no lugar.
    select conname into fk
    from pg_constraint
    where conrelid = format('public.%I', t)::regclass
      and contype = 'f'
      and confrelid = 'auth.users'::regclass
      and conkey = array[
        (select attnum from pg_attribute
         where attrelid = format('public.%I', t)::regclass and attname = 'user_id')
      ];

    -- Falhar alto: pular esta troca deixaria apagar a conta de um membro
    -- apagando em cascata tudo que ele criou — que agora é dado do workspace.
    if fk is null then
      raise exception 'FK de %.user_id para auth.users nao encontrada — abortando', t;
    end if;

    execute format('alter table %I drop constraint %I', t, fk);
    execute format(
      'alter table %I add constraint %I foreign key (user_id) references auth.users(id) on delete set null',
      t, fk);

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
-- e o CRM aceita as duplicatas caladas. Expressões idênticas às da 006.
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
--
-- O filtro olha qual E with_check: a policy antiga pode ter o bucket_id em
-- qualquer um dos dois, dependendo de como foi criada.
-- ---------------------------------------------------------------------------
do $mig$
declare p record;
begin
  for p in select policyname from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
             and (coalesce(qual, '') || coalesce(with_check, '')) like '%company-documents%' loop
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
--
-- Títulos e cores copiados verbatim da 008_kanban_pipeline.sql — são os que
-- estão em produção. O drop é necessário porque trocar o NOME de um parâmetro
-- não é permitido por CREATE OR REPLACE.
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

  insert into kanban_columns (workspace_id, title, color, position)
  values
    (p_workspace_id, 'Alvos',             '#64748b',  1),
    (p_workspace_id, 'Contato',           '#6366f1',  2),
    (p_workspace_id, 'Diagnóstico',       '#3b82f6',  3),
    (p_workspace_id, 'Dor validada',      '#0ea5e9',  4),
    (p_workspace_id, 'Solução desenhada', '#8b5cf6',  5),
    (p_workspace_id, 'Prova',             '#f59e0b',  6),
    (p_workspace_id, 'Aprovação',         '#ec4899',  7),
    (p_workspace_id, 'Ganho',             '#10b981',  8),
    (p_workspace_id, 'Perdido',           '#ef4444',  9),
    (p_workspace_id, 'Gelado',            '#94a3b8', 10);
end;
$fn$;

commit;
