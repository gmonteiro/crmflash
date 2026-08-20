-- 010_workspaces_rollback.sql
-- Desfaz a 010. Os dados não se moveram: só a coluna workspace_id e as policies
-- mudaram, então voltar é restaurar o escopo por user_id e dropar a coluna.
--
-- ATENÇÃO: não restaura o user_id das linhas cujo autor tenha sido apagado
-- depois da 010 (ficaram NULL por ON DELETE SET NULL) — e o
-- `alter column user_id set not null` abaixo vai FALHAR se isso tiver
-- acontecido. Nesse caso, restaure do backup do scripts/backup-tables.mjs antes.

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
drop function if exists default_workspace();
drop table if exists workspace_invitations;
drop table if exists workspace_members;
drop table if exists workspaces;
drop function if exists current_workspace();

-- Restaura a função exatamente como está na 008_kanban_pipeline.sql.
drop function if exists create_default_kanban_columns(uuid);

create or replace function create_default_kanban_columns(p_user_id uuid)
returns void
language plpgsql
security definer
as $fn$
begin
  if p_user_id != auth.uid() then
    raise exception 'Cannot create kanban columns for another user';
  end if;

  insert into kanban_columns (user_id, title, color, position)
  values
    (p_user_id, 'Alvos',             '#64748b',  1),
    (p_user_id, 'Contato',           '#6366f1',  2),
    (p_user_id, 'Diagnóstico',       '#3b82f6',  3),
    (p_user_id, 'Dor validada',      '#0ea5e9',  4),
    (p_user_id, 'Solução desenhada', '#8b5cf6',  5),
    (p_user_id, 'Prova',             '#f59e0b',  6),
    (p_user_id, 'Aprovação',         '#ec4899',  7),
    (p_user_id, 'Ganho',             '#10b981',  8),
    (p_user_id, 'Perdido',           '#ef4444',  9),
    (p_user_id, 'Gelado',            '#94a3b8', 10);
end;
$fn$;

commit;
