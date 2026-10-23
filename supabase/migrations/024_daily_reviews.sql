-- 024_daily_reviews.sql
--
-- Revisão diária das contas ativas (spec, seção 8). Uma linha por empresa e
-- por dia: rodar o job de novo no mesmo dia não refaz nem gasta modelo.
-- O veredito cita os eventos que o sustentam (evidence_activity_ids: ids de
-- activities, ou "manual:<id>" para company_activities).
--
-- RODAR NO SUPABASE SQL EDITOR DO CRM, ANTES DO DEPLOY.

begin;

create table if not exists daily_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default default_workspace() references workspaces (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  review_date date not null,
  verdict text not null check (verdict in ('avanco', 'estagnacao', 'risco')),
  rationale text not null,
  evidence_activity_ids text[] not null default '{}',
  model text not null,
  prompt_version text not null,
  stage_suggestion text,
  next_step text,
  created_at timestamptz not null default now(),
  unique (workspace_id, company_id, review_date)
);
create index if not exists idx_daily_reviews_date on daily_reviews (workspace_id, review_date);

do $rls$
begin
  if not exists (select 1 from pg_policies where tablename = 'daily_reviews') then
    alter table daily_reviews enable row level security;
    create policy daily_reviews_ws_select on daily_reviews for select using (workspace_id = current_workspace());
    create policy daily_reviews_ws_insert on daily_reviews for insert with check (workspace_id = current_workspace());
  end if;
end
$rls$;

commit;
