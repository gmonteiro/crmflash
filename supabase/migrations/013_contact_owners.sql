-- 013_contact_owners.sql
-- Dono de contato: quem trabalha aquela pessoa, que nao e a mesma coisa que
-- quem criou a linha (`user_id`, que a 010 rebaixou a autoria).
-- Ver docs/superpowers/specs/2026-08-24-crmflash-donos-de-contato-design.md
--
-- RODAR INTEIRA, DE UMA VEZ, NO SQL EDITOR DO SUPABASE.
-- Exige Postgres 15+ (security_invoker em view).

begin;

-- ---------------------------------------------------------------------------
-- 1. people_owners
--
-- Tabela, e nao coluna, porque o caso que motivou isto e justamente o contato
-- em comum: o dedup do import pula quem ja existe, entao "a Maria tambem tem
-- esse contato" nao cabe em `people.user_id`. Cardinalidade faltando, nao
-- coluna faltando.
--
-- Sem workspace_id: escopada pelo pai, como people_tags e shortlist_members.
-- A PK composta e o que torna "cada pessoa e dona no maximo uma vez"
-- invariante de banco em vez de regra que o import precisa lembrar.
--
-- on delete cascade no user_id, e nao o set null que a 010 usou em
-- people.user_id: autoria e historico e sobrevive a conta apagada;
-- propriedade e vinculo vivo e morre com ela. Contato pode ficar sem dono;
-- nao pode ter dono que nao existe.
-- ---------------------------------------------------------------------------
create table people_owners (
  person_id  uuid not null references people(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (person_id, user_id)
);

-- A PK ja indexa person_id. Este e para o outro lado: sem ele, apagar uma
-- conta faz seq scan da tabela inteira para achar os vinculos em cascata.
create index idx_people_owners_user on people_owners(user_id);

comment on table people_owners is
  'Quem trabalha este contato. Diferente de people.user_id, que e autoria.';

alter table people_owners enable row level security;

create policy people_owners_ws_all on people_owners for all
  using (
    exists (
      select 1 from people p
      where p.id = people_owners.person_id
        and p.workspace_id = current_workspace()
    )
  )
  with check (
    exists (
      select 1 from people p
      where p.id = people_owners.person_id
        and p.workspace_id = current_workspace()
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Backfill: quem criou passa a ser dono do que criou
-- ---------------------------------------------------------------------------
insert into people_owners (person_id, user_id)
select id, user_id from people where user_id is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Trigger: todo contato novo nasce com o autor como dono
--
-- Contato nasce em cinco lugares (import, formulario, copilot e as duas rotas
-- de /api/integration). Escrever o dono em cada um e cinco lugares para
-- esquecer — e o sexto ja nasce errado. No trigger vira propriedade do schema.
--
-- security definer: o formulario escreve como usuario autenticado, e o insert
-- de dentro do trigger passaria pela policy acima; falhar ali derrubaria a
-- criacao do contato inteiro. Nao abre nada — a funcao so insere (new.id,
-- new.user_id), valores que a propria linha ja carrega.
-- ---------------------------------------------------------------------------
create or replace function seed_person_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.user_id is not null then
    insert into people_owners (person_id, user_id)
    values (new.id, new.user_id)
    on conflict do nothing;
  end if;
  return new;
end;
$fn$;

create trigger people_owners_seed
  after insert on people
  for each row execute function seed_person_owner();

-- ---------------------------------------------------------------------------
-- 4. company_owners: view, nao tabela
--
-- Uma tabela precisaria ser mantida em sincronia toda vez que um contato troca
-- de empresa, ganha dono ou e apagado. A view nao sai de sincronia porque nao
-- guarda nada. Com leitura de 25 empresas por pagina e idx_people_company_id
-- no lugar (migration 001), materializar nao se paga.
--
-- security_invoker: avaliada com os privilegios de QUEM CONSULTA, entao a RLS
-- de people e companies continua valendo. Sem isso a view rodaria como dona e
-- devolveria os donos de qualquer workspace.
--
-- union e nao union all: o mesmo usuario aparece pelos dois lados quando criou
-- a empresa e tambem tem contato nela.
-- ---------------------------------------------------------------------------
create view company_owners
with (security_invoker = on) as
  select p.company_id as company_id, po.user_id
    from people p
    join people_owners po on po.person_id = p.id
   where p.company_id is not null
  union
  select c.id as company_id, c.user_id
    from companies c
   where c.user_id is not null;

comment on view company_owners is
  'Donos derivados: quem e dono de algum contato da empresa, mais quem criou a empresa.';

-- ---------------------------------------------------------------------------
-- 5. Grants
--
-- Explicitos porque a licao da 012 foi que privilegio herdado de PUBLIC nao
-- some com revoke no papel. Nem anon nem PUBLIC tem o que fazer aqui: sem
-- sessao, current_workspace() e nulo e as duas relacoes devolvem vazio de
-- qualquer forma — fechar e higiene, nao remendo.
-- ---------------------------------------------------------------------------
revoke all on people_owners  from public, anon;
revoke all on company_owners from public, anon;

grant select, insert, delete on people_owners  to authenticated;
grant select                 on company_owners to authenticated;

grant all    on people_owners  to service_role;
grant select on company_owners to service_role;

commit;
