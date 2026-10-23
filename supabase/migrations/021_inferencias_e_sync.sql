-- 021_inferencias_e_sync.sql
-- O que a IA conclui, com a evidência de onde tirou; o espelho do Calendar; e
-- os cursores de sincronização.
--
-- 1. inferences: toda conclusão de modelo (champion, comprador, dor, sinal,
--    próximo passo, sugestão de estágio) com a citação literal, o modelo e a
--    versão do prompt. Status: proposed → applied | rejected | superseded.
--    Única por (evento de origem, versão da origem, campo, versão do prompt):
--    reprocessar não duplica.
-- 2. Proveniência nas tabelas que a IA alimenta: next_steps e signals ganham
--    inference_id e source_activity_id; next_steps ganha source_ref (único),
--    que é a chave de idempotência do passo extraído.
-- 3. calendar_events + calendar_event_companies: espelho mínimo dos convites
--    com participante externo, e a(s) empresa(s) a que cada um foi ligado.
-- 4. sync_cursors: syncToken do Calendar, cursor do TranscriptionApp, etc.
--
-- RODAR INTEIRA, DE UMA VEZ, NO SUPABASE SQL EDITOR.

begin;

-- ---------------------------------------------------------------------------
-- 1. inferences
-- ---------------------------------------------------------------------------
create table if not exists inferences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default default_workspace() references workspaces (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  field text not null,
  value jsonb not null,
  evidence jsonb not null default '[]'::jsonb,
  source_activity_id uuid references activities (id) on delete set null,
  source_version text not null default '',
  model text not null,
  prompt_version text not null,
  status text not null default 'proposed' check (status in ('proposed', 'applied', 'rejected', 'superseded')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
comment on column inferences.field is
  'champion | economic_buyer | pain_hypothesis | signal:<tipo> | next_step:<n> | stage_suggestion | summary';
-- source_version entra na chave: a transcrição refeita (transcribe-full de
-- novo) é outra versão e pode ser reextraída; a mesma versão, nunca.
create unique index if not exists idx_inferences_idem
  on inferences (workspace_id, source_activity_id, source_version, field, prompt_version);
create index if not exists idx_inferences_company_status on inferences (company_id, status);

-- ---------------------------------------------------------------------------
-- 2. Proveniência
-- ---------------------------------------------------------------------------
alter table company_next_steps
  add column if not exists source_ref text,
  add column if not exists source_activity_id uuid references activities (id) on delete set null,
  add column if not exists inference_id uuid references inferences (id) on delete set null;
create unique index if not exists idx_next_steps_source_ref on company_next_steps (workspace_id, source_ref);

alter table company_commitment_signals
  add column if not exists source_activity_id uuid references activities (id) on delete set null,
  add column if not exists inference_id uuid references inferences (id) on delete set null,
  add column if not exists evidence jsonb;

alter table companies
  add column if not exists context_inference_ids jsonb not null default '{}'::jsonb;
comment on column companies.context_inference_ids is
  '{champion_name: <inference_id>, economic_buyer_name: ..., pain_hypothesis: ...}: qual inferência sustenta cada campo. Vazio = escrito à mão.';

-- ---------------------------------------------------------------------------
-- 3. Calendar
-- ---------------------------------------------------------------------------
create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default default_workspace() references workspaces (id) on delete cascade,
  google_event_id text not null,
  ical_uid text,
  recurring_event_id text,
  summary text,
  start_at timestamptz,
  end_at timestamptz,
  status text not null default 'confirmed',
  organizer_email text,
  attendees jsonb not null default '[]'::jsonb,
  html_link text,
  meet_link text,
  etag text,
  transcription_meeting_id text,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists idx_calendar_events_google on calendar_events (workspace_id, google_event_id);
create index if not exists idx_calendar_events_start on calendar_events (workspace_id, start_at);

create table if not exists calendar_event_companies (
  calendar_event_id uuid not null references calendar_events (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  workspace_id uuid not null default default_workspace() references workspaces (id) on delete cascade,
  linked_by text not null,
  created_at timestamptz not null default now(),
  primary key (calendar_event_id, company_id)
);
create index if not exists idx_calendar_event_companies_company on calendar_event_companies (company_id);

-- ---------------------------------------------------------------------------
-- 4. sync_cursors
-- ---------------------------------------------------------------------------
create table if not exists sync_cursors (
  workspace_id uuid not null default default_workspace() references workspaces (id) on delete cascade,
  source text not null,
  key text not null default 'default',
  cursor text,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, source, key)
);

-- ---------------------------------------------------------------------------
-- RLS: mesmo padrão da 010
-- ---------------------------------------------------------------------------
do $rls$
declare
  t text;
begin
  foreach t in array array['inferences', 'calendar_events', 'calendar_event_companies', 'sync_cursors'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (workspace_id = current_workspace())', t || '_ws_select', t);
    execute format('create policy %I on %I for insert with check (workspace_id = current_workspace())', t || '_ws_insert', t);
    execute format('create policy %I on %I for update using (workspace_id = current_workspace()) with check (workspace_id = current_workspace())', t || '_ws_update', t);
    execute format('create policy %I on %I for delete using (workspace_id = current_workspace())', t || '_ws_delete', t);
  end loop;
end
$rls$;

commit;
