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
