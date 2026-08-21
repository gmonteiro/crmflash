-- 011_member_emails.sql
-- Rotular autoria na UI exige e-mail, e auth.users não é legível pelo cliente.
-- Fecha também uma folga deixada pela 010 (ver parte 2).

begin;

-- ---------------------------------------------------------------------------
-- 1. E-mails dos membros do MEU workspace
--
-- SECURITY DEFINER para alcançar auth.users. O filtro por current_workspace()
-- é o que impede isto de virar um diretório de todos os usuários da instância:
-- sem ele, qualquer pessoa logada listaria o e-mail de qualquer outra.
-- ---------------------------------------------------------------------------
create or replace function workspace_member_emails()
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = public
as $fn$
  select m.user_id, u.email::text
  from workspace_members m
  join auth.users u on u.id = m.user_id
  where m.workspace_id = current_workspace();
$fn$;

revoke execute on function workspace_member_emails() from anon;

-- ---------------------------------------------------------------------------
-- 2. default_workspace() não deveria responder a quem não está logado
--
-- A 010 criou a função para cobrir as escritas com service role, onde
-- auth.uid() é nulo. Efeito colateral: como toda função em public fica exposta
-- como RPC, um chamador anônimo descobre o UUID do workspace só perguntando.
--
-- Não vaza dado — a RLS barra tudo que está atrás desse id — mas é um
-- identificador interno que não tem por que circular. O papel `anon` nunca
-- precisa dela: quem escreve com service role não passa por GRANTs de RLS.
-- ---------------------------------------------------------------------------
revoke execute on function default_workspace() from anon;

commit;
