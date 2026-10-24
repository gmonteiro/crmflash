-- 027_avisos_de_agenda.sql
--
-- Aviso do Google Agenda por e-mail (Aceito:, Convite atualizado:, Cancelado:...)
-- não é conversa nem ação do cliente (D4). O ingest novo já grava esses e-mails
-- com client_engaged = false e conversation_key nulo; esta migração corrige o
-- que entrou antes:
--
-- 1. Acha as atividades do Gmail cujo assunto casa com o regex de aviso (o
--    mesmo CALENDAR_NOTICE_SUBJECT de src/lib/google/gmail.ts).
-- 2. Conta cujo last_client_event_at veio de um desses avisos: recalcula como
--    o maior occurred_at das demais atividades client_engaged. Sem nenhuma,
--    deixa o valor como está (aparece na conferência 2, para olhar na mão).
-- 3. Marca os avisos: client_engaged = false, conversation_key = null,
--    engagement_rule = 'email.calendar_notice'. A tabela activities não tem
--    coluna de facts (só evidence, com a prova do e-mail), então o
--    facts.calendarNotice fica de fora; a regra gravada é o registro auditável.
--
-- Idempotente: rodar de novo não acha nada novo.
-- RODAR INTEIRA, DE UMA VEZ, NO SUPABASE SQL EDITOR.

begin;

create temp table _avisos_agenda on commit drop as
select a.id, a.company_id, a.occurred_at, a.client_engaged
  from activities a
 where a.source = 'gmail'
   and regexp_replace(a.title, '^E-mail( enviado)?: ', '') ~*
       '^\s*(aceit[oa]|recusad[oa]|talvez|accepted|declined|tentative|convite( atualizado)?|invitation|updated invitation|(evento )?cancelado|cancell?ed event|nova proposta de hor[aá]rio|proposed new time)\s*:';

-- Contas que ficam sem referência: o contador estava no instante de um aviso.
create temp table _contas_afetadas on commit drop as
select distinct v.company_id
  from _avisos_agenda v
  join companies c on c.id = v.company_id
 where v.client_engaged
   and c.last_client_event_at = v.occurred_at;

update companies c
   set last_client_event_at = r.novo
  from (
    select ca.company_id, max(a.occurred_at) as novo
      from _contas_afetadas ca
      join activities a
        on a.company_id = ca.company_id
       and a.client_engaged
       and a.id not in (select id from _avisos_agenda)
     group by ca.company_id
  ) r
 where c.id = r.company_id;

update activities a
   set client_engaged = false,
       conversation_key = null,
       engagement_rule = 'email.calendar_notice'
  from _avisos_agenda v
 where a.id = v.id
   and (a.client_engaged or a.conversation_key is not null or a.engagement_rule is distinct from 'email.calendar_notice');

commit;

-- CONFERÊNCIA 1: avisos que sobraram com ação do cliente ou conversa (esperado: 0).
-- select count(*) from activities
--  where source = 'gmail'
--    and regexp_replace(title, '^E-mail( enviado)?: ', '') ~*
--        '^\s*(aceit[oa]|recusad[oa]|talvez|accepted|declined|tentative|convite( atualizado)?|invitation|updated invitation|(evento )?cancelado|cancell?ed event|nova proposta de hor[aá]rio|proposed new time)\s*:'
--    and (client_engaged or conversation_key is not null);

-- CONFERÊNCIA 2: contas cujo contador veio de um aviso e não tinha outra ação
-- do cliente para assumir (o valor ficou como estava; olhar uma a uma).
-- select c.id, c.name, c.last_client_event_at
--   from companies c
--  where c.last_client_event_at is not null
--    and not exists (
--      select 1 from activities a
--       where a.company_id = c.id and a.client_engaged and a.occurred_at = c.last_client_event_at)
--    and exists (
--      select 1 from activities a
--       where a.company_id = c.id and a.engagement_rule = 'email.calendar_notice'
--         and a.occurred_at = c.last_client_event_at);
