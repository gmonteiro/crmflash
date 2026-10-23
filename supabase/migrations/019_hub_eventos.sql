-- 019_hub_eventos.sql
-- A tabela `activities` passa a ser o registro de EVENTOS do hub: tudo o que
-- aconteceu com uma conta, de qualquer origem, num formato só.
--
-- POR QUE ESTENDER `activities` E NÃO CRIAR UMA TERCEIRA TIMELINE
-- `activities` (004) já é a tabela de integração, já é lida pelo snapshot do
-- copiloto (regra meeting_yesterday) e pelo ActivityTimeline. Criar outra
-- tabela seria a terceira timeline que não conversa com as outras duas.
--
-- O QUE MUDA
-- 1. source aceita as fontes novas (calendar, gmail, whatsapp, github, drive, mcp).
-- 2. Envelope do evento: kind, source_id, source_version, idempotency_key,
--    occurred_at, direction, client_engaged, engagement_rule, evidence.
-- 3. client_engaged deixa de ser só parâmetro de tool: fica gravado no evento,
--    com o id da regra que decidiu. É o que torna auditável "por que esta conta
--    parece viva".
-- 4. O índice único antigo (user_id, source, source_meeting_id) sai. Ele
--    estourava 500 quando a MESMA reunião ia para duas pessoas, e o dedup novo
--    é por idempotency_key, por workspace.
-- 5. activity_participants: um evento envolve N pessoas.
-- 6. bump_client_event(): o reset do contador usa a data REAL do evento, com
--    GREATEST. Reprocessar uma transcrição antiga não rejuvenesce a conta.
--
-- RODAR INTEIRA, DE UMA VEZ, NO SUPABASE SQL EDITOR.

begin;

-- ---------------------------------------------------------------------------
-- 1. Fontes
-- ---------------------------------------------------------------------------
alter table activities drop constraint if exists activities_source_check;
alter table activities add constraint activities_source_check check (source in (
  'manual', 'mcp', 'transcription_app', 'calendar', 'gmail', 'whatsapp', 'github', 'drive'
));

-- ---------------------------------------------------------------------------
-- 2. Envelope
-- ---------------------------------------------------------------------------
alter table activities
  add column if not exists kind text,
  add column if not exists source_id text,
  add column if not exists source_version text,
  add column if not exists idempotency_key text,
  add column if not exists occurred_at timestamptz,
  add column if not exists direction text,
  add column if not exists client_engaged boolean not null default false,
  add column if not exists engagement_rule text,
  add column if not exists evidence jsonb,
  add column if not exists processor_version text;

alter table activities drop constraint if exists activities_direction_check;
alter table activities add constraint activities_direction_check
  check (direction is null or direction in ('inbound', 'outbound', 'internal'));

comment on column activities.kind is
  'Vocabulário do hub: email.received, meeting.scheduled, meeting.held, transcript.ready... ver src/lib/events/types.ts';
comment on column activities.client_engaged is
  'true só quando o CLIENTE agiu. Decidido por src/lib/events/engagement.ts; a regra fica em engagement_rule.';
comment on column activities.idempotency_key is
  'sha256(source:source_id:kind:company_id). Reprocessar a mesma origem cai neste índice e não duplica.';

-- Linhas antigas: occurred_at = date, para a timeline nova ordenar igual.
update activities set occurred_at = date where occurred_at is null;

-- ---------------------------------------------------------------------------
-- 3. Índices
--
-- Índice ÚNICO cheio, não parcial: o PostgREST só endereça onConflict por
-- índice sem WHERE (a 015 explica). NULL não colide no Postgres, então as
-- linhas antigas, sem chave, convivem.
-- ---------------------------------------------------------------------------
drop index if exists idx_activities_source_dedup;
create unique index if not exists idx_activities_idem on activities (workspace_id, idempotency_key);
create index if not exists idx_activities_company_occurred on activities (company_id, occurred_at desc);
create index if not exists idx_activities_source_id on activities (workspace_id, source, source_id);

-- ---------------------------------------------------------------------------
-- 4. Participantes
-- ---------------------------------------------------------------------------
create table if not exists activity_participants (
  activity_id uuid not null references activities (id) on delete cascade,
  person_id uuid not null references people (id) on delete cascade,
  role text not null check (role in ('from', 'to', 'cc', 'attendee', 'organizer', 'speaker', 'assignee')),
  workspace_id uuid not null default default_workspace() references workspaces (id) on delete cascade,
  primary key (activity_id, person_id, role)
);
create index if not exists idx_activity_participants_person on activity_participants (person_id);

alter table activity_participants enable row level security;
create policy activity_participants_ws_select on activity_participants for select
  using (workspace_id = current_workspace());
create policy activity_participants_ws_insert on activity_participants for insert
  with check (workspace_id = current_workspace());
create policy activity_participants_ws_delete on activity_participants for delete
  using (workspace_id = current_workspace());

-- ---------------------------------------------------------------------------
-- 5. Reset do contador com a data real
--
-- SECURITY INVOKER (o padrão): chamada pelo MCP, roda como o usuário e a RLS
-- de companies vale; chamada pelo cron com service role, passa direto.
-- Devolve o valor final, para quem chamou saber se subiu.
-- ---------------------------------------------------------------------------
create or replace function bump_client_event(p_company_id uuid, p_occurred_at timestamptz)
returns timestamptz
language sql
as $fn$
  update companies
     set last_client_event_at = greatest(coalesce(last_client_event_at, p_occurred_at), p_occurred_at)
   where id = p_company_id
  returning last_client_event_at;
$fn$;

grant execute on function bump_client_event(uuid, timestamptz) to authenticated, service_role;

commit;
