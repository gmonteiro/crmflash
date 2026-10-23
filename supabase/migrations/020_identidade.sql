-- 020_identidade.sql
-- Resolução de identidade: saber que joao@acme.com.br, +55 21 9xxxx, "João S."
-- no convite e "João" na transcrição são a mesma pessoa da mesma empresa.
--
-- O QUE ENTRA
-- 1. person_identities: e-mails, telefones, wa_id, nomes vistos no Calendar e
--    na transcrição, cada um apontando para UMA pessoa (ou marcado como
--    ignorado, por exemplo um fornecedor). Único por (workspace, kind, valor).
-- 2. company_domains: domínio de e-mail → empresa. Único por workspace.
-- 3. identity_reviews: a fila de casos ambíguos, que você resolve. Resolver
--    grava a identidade como 'confirmed', e a mesma pergunta não volta.
-- 4. people_merges: auditoria de fusões, com snapshot para desfazer.
-- 5. companies.name_key: nome normalizado (sem acento, sem pontuação, sem
--    sufixo societário). "Acme", "ACME Ltda." e "Acme S/A" dão a mesma chave.
--    O índice único só é criado se não houver duplicados hoje; se houver, a
--    migração avisa e segue sem ele (ver a consulta no fim).
-- 6. Backfill: people.email e companies.domain que já existem viram
--    identidades.
--
-- A normalização do name_key TEM que ser a mesma de companyNameKey() em
-- src/lib/identity/normalize.ts. Mudou uma, mude a outra.
--
-- RODAR INTEIRA, DE UMA VEZ, NO SUPABASE SQL EDITOR.

begin;

create extension if not exists unaccent with schema extensions;

-- unaccent() não é IMMUTABLE (depende do dicionário), e coluna gerada exige
-- função imutável. O wrapper com o dicionário fixo é o padrão para isso.
create or replace function immutable_unaccent(text)
returns text
language sql
immutable
parallel safe
strict
as $fn$
  select extensions.unaccent('extensions.unaccent'::regdictionary, $1)
$fn$;

create or replace function company_name_key(p_name text)
returns text
language sql
immutable
parallel safe
as $fn$
  select nullif(trim(regexp_replace(
    ' ' || trim(regexp_replace(lower(immutable_unaccent(coalesce(p_name, ''))), '[^a-z0-9]+', ' ', 'g')),
    '( (ltda|sa|s a|me|epp|eireli|inc|llc|ltd|cia))+$',
    ''
  )), '')
$fn$;

-- ---------------------------------------------------------------------------
-- 1. person_identities
-- ---------------------------------------------------------------------------
create table if not exists person_identities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default default_workspace() references workspaces (id) on delete cascade,
  person_id uuid references people (id) on delete cascade,
  ignored boolean not null default false,
  kind text not null check (kind in ('email', 'phone', 'wa_id', 'calendar_name', 'speaker_name', 'github')),
  value_norm text not null,
  value_raw text,
  source text not null,
  confidence text not null check (confidence in ('strong', 'confirmed', 'weak')),
  first_seen_activity_id uuid references activities (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint person_identity_target check (person_id is not null or ignored)
);
create unique index if not exists idx_person_identities_value on person_identities (workspace_id, kind, value_norm);
create index if not exists idx_person_identities_person on person_identities (person_id);

-- ---------------------------------------------------------------------------
-- 2. company_domains
-- ---------------------------------------------------------------------------
create table if not exists company_domains (
  workspace_id uuid not null default default_workspace() references workspaces (id) on delete cascade,
  domain text not null,
  company_id uuid references companies (id) on delete cascade,
  ignored boolean not null default false,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  primary key (workspace_id, domain),
  constraint company_domain_target check (company_id is not null or ignored)
);
create index if not exists idx_company_domains_company on company_domains (company_id);

-- ---------------------------------------------------------------------------
-- 3. identity_reviews
-- ---------------------------------------------------------------------------
create table if not exists identity_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default default_workspace() references workspaces (id) on delete cascade,
  company_id uuid references companies (id) on delete cascade,
  observed jsonb not null,
  candidates jsonb not null default '[]'::jsonb,
  reason text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  resolution jsonb,
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  dedup_key text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_identity_reviews_dedup on identity_reviews (workspace_id, dedup_key);
create index if not exists idx_identity_reviews_open on identity_reviews (workspace_id, status) where status = 'open';

-- ---------------------------------------------------------------------------
-- 4. people_merges
-- ---------------------------------------------------------------------------
create table if not exists people_merges (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default default_workspace() references workspaces (id) on delete cascade,
  survivor_id uuid not null references people (id) on delete cascade,
  merged_id uuid not null,
  snapshot jsonb not null,
  merged_by uuid references auth.users (id) on delete set null,
  merged_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS: mesmo padrão da 010
-- ---------------------------------------------------------------------------
do $rls$
declare
  t text;
begin
  foreach t in array array['person_identities', 'company_domains', 'identity_reviews', 'people_merges'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (workspace_id = current_workspace())', t || '_ws_select', t);
    execute format('create policy %I on %I for insert with check (workspace_id = current_workspace())', t || '_ws_insert', t);
    execute format('create policy %I on %I for update using (workspace_id = current_workspace()) with check (workspace_id = current_workspace())', t || '_ws_update', t);
    execute format('create policy %I on %I for delete using (workspace_id = current_workspace())', t || '_ws_delete', t);
  end loop;
end
$rls$;

-- ---------------------------------------------------------------------------
-- 5. companies.name_key
-- ---------------------------------------------------------------------------
alter table companies
  add column if not exists name_key text generated always as (company_name_key(name)) stored;
create index if not exists idx_companies_name_key on companies (workspace_id, name_key);

do $uniq$
declare
  dups int;
begin
  select count(*) into dups from (
    select workspace_id, name_key from companies
     where name_key is not null
     group by 1, 2 having count(*) > 1
  ) d;
  if dups = 0 then
    create unique index if not exists idx_companies_name_key_unique on companies (workspace_id, name_key);
  else
    raise notice 'companies: % chaves de nome duplicadas. Índice único NÃO criado. Resolva com merge_companies e rode o create unique index do fim deste arquivo.', dups;
  end if;
end
$uniq$;

-- ---------------------------------------------------------------------------
-- 6. Backfill
--
-- E-mail: lower+trim; para gmail.com, sem pontos e sem +tag no local-part
-- (mesma regra de normalizeEmail). Se dois cadastros têm o mesmo e-mail, o
-- mais antigo fica com a identidade e o outro vira revisão na primeira vez em
-- que o e-mail aparecer numa fonte.
-- ---------------------------------------------------------------------------
insert into person_identities (workspace_id, person_id, kind, value_norm, value_raw, source, confidence)
select distinct on (p.workspace_id, e.norm)
       p.workspace_id, p.id, 'email', e.norm, p.email, 'backfill', 'strong'
  from people p
  cross join lateral (
    select case
      when split_part(lower(trim(p.email)), '@', 2) in ('gmail.com', 'googlemail.com') then
        replace(split_part(split_part(lower(trim(p.email)), '@', 1), '+', 1), '.', '') || '@gmail.com'
      else lower(trim(p.email))
    end as norm
  ) e
 where p.email is not null and position('@' in p.email) > 1
 order by p.workspace_id, e.norm, p.created_at
on conflict do nothing;

-- Domínio: o que estiver em companies.domain, sem esquema, sem www, sem barra.
insert into company_domains (workspace_id, domain, company_id, source)
select distinct on (c.workspace_id, d.dom)
       c.workspace_id, d.dom, c.id, 'backfill'
  from companies c
  cross join lateral (
    select regexp_replace(regexp_replace(lower(trim(c.domain)), '^https?://', ''), '^www\.|/.*$', '', 'g') as dom
  ) d
 where c.domain is not null and d.dom like '%.%'
 order by c.workspace_id, d.dom, c.created_at
on conflict do nothing;

commit;

-- ---------------------------------------------------------------------------
-- Se o aviso de duplicados apareceu: liste-os, resolva, e depois rode o create.
--
-- select workspace_id, name_key, array_agg(name order by created_at) as nomes, array_agg(id order by created_at) as ids
--   from companies where name_key is not null group by 1, 2 having count(*) > 1;
--
-- create unique index idx_companies_name_key_unique on companies (workspace_id, name_key);
-- ---------------------------------------------------------------------------
