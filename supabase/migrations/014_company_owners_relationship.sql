-- 014_company_owners_relationship.sql
-- Torna company_owners filtravel a partir de companies.
--
-- POR QUE ISTO PRECISA EXISTIR
-- Filtrar a listagem por dono e, no PostgREST, um embed com !inner. Para
-- people funciona de graca: existe FK people_owners.person_id -> people.id e a
-- relacao e inferida. Para companies nao: company_owners e uma view com union,
-- nao tem FK, e o pedido volta PGRST200 "no matches were found".
--
-- A alternativa sem migration seria filtrar por
--   companies?select=*,people!inner(people_owners!inner(user_id))
-- que responde "empresas com contato meu" — e perde as 15 empresas sem contato
-- nenhum, onde o dono e so quem criou. Filtro que discorda da coluna que esta
-- do lado e pior que filtro nenhum.
--
-- RODAR INTEIRA, DE UMA VEZ, NO SQL EDITOR DO SUPABASE.

begin;

-- ---------------------------------------------------------------------------
-- Relacao computada: uma funcao que recebe a linha de companies e devolve as
-- linhas de company_owners dela. O PostgREST reconhece essa assinatura
-- (um argumento do tipo composto da tabela, returns setof) e passa a aceitar
--   companies?select=*,owners!inner(user_id)&owners.user_id=eq.<uuid>
-- O nome da funcao e o nome da relacao no select.
--
-- stable e NAO security definer: assim roda com os privilegios de quem
-- consulta, e o security_invoker da view continua valendo. Definer aqui
-- devolveria os donos de qualquer workspace.
-- ---------------------------------------------------------------------------
create or replace function owners(companies)
returns setof company_owners
language sql
stable
as $fn$
  select co.*
  from company_owners co
  where co.company_id = $1.id;
$fn$;

comment on function owners(companies) is
  'Relacao computada para o PostgREST: companies -> company_owners. Ver 014.';

revoke execute on function owners(companies) from public, anon;
grant  execute on function owners(companies) to authenticated;
grant  execute on function owners(companies) to service_role;

commit;
