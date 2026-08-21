-- 012_fix_function_grants.sql
-- Conserta os REVOKE da 011, que rodaram sem efeito.
--
-- POR QUE A 011 NAO FUNCIONOU
-- Toda funcao criada em `public` recebe EXECUTE para o pseudo-papel PUBLIC por
-- padrao. O privilegio do `anon` nao vem dele mesmo, vem herdado de PUBLIC —
-- entao `revoke execute ... from anon` executa com sucesso e nao muda nada.
-- Verificado: depois da 011, anon ainda recebia o UUID do workspace.
--
-- CUIDADO QUE ESTA MIGRATION PRECISA TER
-- default_workspace() e o DEFAULT de coluna nas 13 tabelas, e defaults sao
-- avaliados com os privilegios de QUEM INSERE. Revogar de PUBLIC sem devolver
-- para authenticated/service_role quebraria todo insert do app.

begin;

-- ---------------------------------------------------------------------------
-- default_workspace(): so quem escreve precisa dela
-- ---------------------------------------------------------------------------
revoke execute on function default_workspace() from public;
revoke execute on function default_workspace() from anon;
grant  execute on function default_workspace() to authenticated;
grant  execute on function default_workspace() to service_role;

-- ---------------------------------------------------------------------------
-- workspace_member_emails(): so gente logada
--
-- Sem sessao ela ja devolvia vazio (current_workspace() e null), entao nunca
-- vazou e-mail. Fechar o acesso e higiene, nao remendo de vazamento.
-- ---------------------------------------------------------------------------
revoke execute on function workspace_member_emails() from public;
revoke execute on function workspace_member_emails() from anon;
grant  execute on function workspace_member_emails() to authenticated;

-- ---------------------------------------------------------------------------
-- current_workspace() NAO entra aqui, de proposito.
--
-- Ela e chamada dentro das policies de RLS, e expressao de policy e avaliada
-- com os privilegios de QUEM CHAMA. Revogar do anon trocaria "0 linhas" por
-- "permission denied for function current_workspace" em qualquer request
-- anonimo que tocasse as 13 tabelas — um erro no lugar de um filtro, sem ganho
-- nenhum: sem sessao ela ja devolve null e nao revela nada.
-- ---------------------------------------------------------------------------

commit;
