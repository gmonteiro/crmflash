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
