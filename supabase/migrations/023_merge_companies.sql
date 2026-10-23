-- 023_merge_companies.sql
--
-- Funde empresas duplicadas. Em 23/10/2026: 2.452 grupos com o mesmo
-- name_key (5.075 linhas a mais em 10.127, quase todas de imports
-- repetidos), e por isso o índice único de nome da 020 ficou de fora.
--
-- 1. company_merges: auditoria. A linha apagada inteira (jsonb) e quantas
--    linhas de cada tabela foram movidas.
-- 2. merge_companies(keep, drop): move TUDO que aponta para a empresa
--    apagada. As tabelas vêm do catálogo (pg_constraint), não de uma lista
--    escrita à mão: tabela nova com FK para companies entra sozinha. Onde o
--    movimento bate num índice único (o sinal já existe na que fica, a
--    pessoa já está na shortlist), a linha da apagada sai.
--    Campos vazios da que fica são preenchidos com os da apagada;
--    last_client_event_at fica com o maior.
-- 3. merge_duplicate_companies(dry_run, limit): escolhe a que fica em cada
--    grupo: a do funil; senão a com mais pessoas + atividades; senão a mais
--    antiga. dry_run = true (padrão) só mostra o plano.
--
-- COMO RODAR, NO SQL EDITOR DO CRM:
--   a) esta migração inteira (só cria as funções; não muda dado);
--   b) select * from merge_duplicate_companies(true) limit 50;   -- o plano
--   c) select count(*) from merge_duplicate_companies(false, 500); -- repita até dar 0
--   d) o create unique index do fim deste arquivo.

begin;

create table if not exists company_merges (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  kept_id uuid not null,
  dropped_id uuid not null,
  dropped_row jsonb not null,
  moved jsonb not null default '{}'::jsonb,
  merged_at timestamptz not null default now()
);
create index if not exists idx_company_merges_kept on company_merges (kept_id);

do $rls$
begin
  if not exists (select 1 from pg_policies where tablename = 'company_merges') then
    alter table company_merges enable row level security;
    create policy company_merges_ws_select on company_merges for select using (workspace_id = current_workspace());
  end if;
end
$rls$;

create or replace function merge_companies(p_keep uuid, p_drop uuid)
returns jsonb
language plpgsql
as $fn$
declare
  k companies%rowtype;
  d companies%rowtype;
  fk record;
  t record;
  n bigint;
  moved jsonb := '{}'::jsonb;
begin
  if p_keep = p_drop then raise exception 'merge_companies: mesma empresa'; end if;
  select * into k from companies where id = p_keep for update;
  select * into d from companies where id = p_drop for update;
  if k.id is null or d.id is null then raise exception 'merge_companies: empresa não encontrada'; end if;
  if k.workspace_id is distinct from d.workspace_id then raise exception 'merge_companies: workspaces diferentes'; end if;

  for fk in
    select c.conrelid::regclass as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid = 'public.companies'::regclass
       and array_length(c.conkey, 1) = 1
       and c.conrelid <> 'public.companies'::regclass
  loop
    begin
      execute format('update %s set %I = $1 where %I = $2', fk.tbl, fk.col, fk.col) using p_keep, p_drop;
      get diagnostics n = row_count;
    exception when unique_violation then
      -- Linha a linha: a que colide com uma que já existe na que fica sai.
      n := 0;
      for t in execute format('select ctid as c from %s where %I = $1', fk.tbl, fk.col) using p_drop loop
        begin
          execute format('update %s set %I = $1 where ctid = $2', fk.tbl, fk.col) using p_keep, t.c;
          n := n + 1;
        exception when unique_violation then
          execute format('delete from %s where ctid = $1', fk.tbl) using t.c;
        end;
      end loop;
    end;
    if n > 0 then moved := moved || jsonb_build_object(fk.tbl::text || '.' || fk.col, n); end if;
  end loop;

  update companies set
    domain = coalesce(k.domain, d.domain),
    linkedin_url = coalesce(k.linkedin_url, d.linkedin_url),
    industry = coalesce(k.industry, d.industry),
    size_tier = coalesce(k.size_tier, d.size_tier),
    estimated_revenue = coalesce(k.estimated_revenue, d.estimated_revenue),
    employee_count = coalesce(k.employee_count, d.employee_count),
    description = coalesce(k.description, d.description),
    logo_url = coalesce(k.logo_url, d.logo_url),
    website = coalesce(k.website, d.website),
    metadata = coalesce(d.metadata, '{}'::jsonb) || coalesce(k.metadata, '{}'::jsonb),
    kanban_column_id = coalesce(k.kanban_column_id, d.kanban_column_id),
    kanban_position = case when k.kanban_column_id is null then d.kanban_position else k.kanban_position end,
    champion_name = coalesce(k.champion_name, d.champion_name),
    economic_buyer_name = coalesce(k.economic_buyer_name, d.economic_buyer_name),
    pain_hypothesis = coalesce(k.pain_hypothesis, d.pain_hypothesis),
    last_client_event_at = greatest(k.last_client_event_at, d.last_client_event_at),
    -- jsonb {campo: id da inferência}: a que fica vence no mesmo campo.
    context_inference_ids = coalesce(d.context_inference_ids, '{}'::jsonb) || coalesce(k.context_inference_ids, '{}'::jsonb)
  where id = p_keep;

  insert into company_merges (workspace_id, kept_id, dropped_id, dropped_row, moved)
  values (k.workspace_id, p_keep, p_drop, to_jsonb(d), moved);

  delete from companies where id = p_drop;
  return moved;
end
$fn$;

create or replace function merge_duplicate_companies(p_dry_run boolean default true, p_limit int default 500)
returns table (name_key text, kept_id uuid, kept_name text, dropped_id uuid, dropped_name text)
language plpgsql
as $fn$
#variable_conflict use_column
declare
  r record;
begin
  for r in
    with dup as (
      select c.workspace_id as ws, c.name_key as nk
        from companies c where c.name_key is not null
       group by 1, 2 having count(*) > 1
    ), pc as (
      select p.company_id as cid, count(*) as n from people p where p.company_id is not null group by 1
    ), ac as (
      select a.company_id as cid, count(*) as n from activities a where a.company_id is not null group by 1
    ), weight as (
      select c.id, c.workspace_id, c.name, c.name_key, c.created_at,
             (c.kanban_column_id is not null) as in_funnel,
             coalesce(pc.n, 0) + coalesce(ac.n, 0) as links
        from companies c
        join dup on dup.ws = c.workspace_id and dup.nk = c.name_key
        left join pc on pc.cid = c.id
        left join ac on ac.cid = c.id
    ), ranked as (
      select w.*,
             row_number() over (partition by w.workspace_id, w.name_key
                                order by w.in_funnel desc, w.links desc, w.created_at asc, w.id) as rn,
             count(*) over (partition by w.workspace_id, w.name_key) as n
        from weight w
    )
    select d.name_key, k.id as kid, k.name as kname, d.id as did, d.name as dname
      from ranked d
      join ranked k on k.workspace_id = d.workspace_id and k.name_key = d.name_key and k.rn = 1
     where d.n > 1 and d.rn > 1
     order by d.name_key, d.rn
     limit p_limit
  loop
    if not p_dry_run then perform merge_companies(r.kid, r.did); end if;
    name_key := r.name_key; kept_id := r.kid; kept_name := r.kname; dropped_id := r.did; dropped_name := r.dname;
    return next;
  end loop;
end
$fn$;

commit;

-- d) Depois que merge_duplicate_companies(false) devolver 0 linhas:
-- create unique index if not exists idx_companies_name_key_unique on companies (workspace_id, name_key);
