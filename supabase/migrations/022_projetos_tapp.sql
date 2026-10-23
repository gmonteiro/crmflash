-- 022_projetos_tapp.sql
--
-- 1. tapp_project_companies: projeto do TranscriptionApp → empresa do CRM.
--    O projeto é escolhido por você no app; ligado uma vez (pela fila,
--    caso projeto_sem_empresa), toda reunião dele desce para a empresa, com
--    ou sem convite. company_id null + ignored = projeto interno.
-- 2. calendar_events.google_created_at: quando o convite foi feito. A
--    religação (depois de resolver a fila) usava "agora" no lugar, e um
--    convite antigo do cliente zerava o contador no dia errado.
-- 3. Zera o syncToken do Calendar: o próximo sync é completo e preenche o
--    google_created_at dos convites já espelhados. Idempotente.
--
-- RODAR INTEIRA, DE UMA VEZ, NO SUPABASE SQL EDITOR, ANTES DO DEPLOY:
-- o código novo lê google_created_at e tapp_project_companies.

begin;

create table if not exists tapp_project_companies (
  workspace_id uuid not null default default_workspace() references workspaces (id) on delete cascade,
  project_id text not null,
  project_name text,
  company_id uuid references companies (id) on delete cascade,
  ignored boolean not null default false,
  source text not null default 'review',
  created_at timestamptz not null default now(),
  primary key (workspace_id, project_id),
  check (ignored or company_id is not null)
);
create index if not exists idx_tapp_project_companies_company on tapp_project_companies (company_id);

alter table calendar_events add column if not exists google_created_at timestamptz;

delete from sync_cursors where source = 'calendar';

do $rls$
begin
  if not exists (select 1 from pg_policies where tablename = 'tapp_project_companies') then
    alter table tapp_project_companies enable row level security;
    create policy tapp_project_companies_ws_select on tapp_project_companies for select using (workspace_id = current_workspace());
    create policy tapp_project_companies_ws_insert on tapp_project_companies for insert with check (workspace_id = current_workspace());
    create policy tapp_project_companies_ws_update on tapp_project_companies for update using (workspace_id = current_workspace()) with check (workspace_id = current_workspace());
    create policy tapp_project_companies_ws_delete on tapp_project_companies for delete using (workspace_id = current_workspace());
  end if;
end
$rls$;

commit;
