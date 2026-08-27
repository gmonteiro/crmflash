-- 016_mcp_oauth.sql
-- Tokens de acesso ao servidor MCP.
--
-- POR QUE ISTO PRECISA EXISTIR
-- O claude.ai (web e celular) só conecta em servidor MCP por OAuth: não há
-- onde colar um Bearer na interface dele. A Fatia 1 usa um token de
-- desenvolvimento em env var, que serve no Claude Code e em mais nada.
--
-- O CRMFlash não vira provedor de identidade. Quem autentica a PESSOA continua
-- sendo o Supabase Auth; estas tabelas só guardam a autorização que ela deu a
-- um cliente, em cima de uma sessão de navegador que já existe.
--
-- Nenhum token é guardado em claro — só sha256 hex. Vazar estas tabelas não
-- pode virar acesso ao CRM de ninguém.
--
-- RODAR INTEIRA, DE UMA VEZ, NO SQL EDITOR DO SUPABASE.

begin;

-- ---------------------------------------------------------------------------
-- 1. Clientes
--
-- Registro dinâmico (RFC 7591): o claude.ai se cadastra sozinho na primeira
-- conexão. Sem client_secret de propósito — é cliente público, a segurança do
-- fluxo vem do PKCE, e um segredo aqui só acrescentaria superfície de vazamento.
-- ---------------------------------------------------------------------------
create table if not exists mcp_oauth_clients (
  client_id     text primary key,
  client_name   text not null,
  redirect_uris text[] not null,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Authorization codes
--
-- Uso único e vida curta. consumed_at em vez de delete: um code reapresentado
-- é sinal de vazamento, e a resposta certa é revogar os tokens que ele gerou —
-- o que exige saber que ele existiu.
-- ---------------------------------------------------------------------------
create table if not exists mcp_oauth_codes (
  code_hash             text primary key,
  client_id             text not null references mcp_oauth_clients(client_id) on delete cascade,
  user_id               uuid not null references auth.users(id) on delete cascade,
  workspace_id          uuid not null references workspaces(id) on delete cascade,
  redirect_uri          text not null,
  code_challenge        text not null,
  code_challenge_method text not null default 'S256'
                          check (code_challenge_method = 'S256'),
  expires_at            timestamptz not null,
  consumed_at           timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists idx_mcp_codes_expires on mcp_oauth_codes(expires_at);

-- ---------------------------------------------------------------------------
-- 3. Tokens
--
-- workspace_id junto do user_id: resolveIdentity precisa dos dois, e resolver
-- o workspace a cada requisição custaria uma consulta a mais no caminho quente.
-- ---------------------------------------------------------------------------
create table if not exists mcp_oauth_tokens (
  id                  uuid primary key default gen_random_uuid(),
  client_id           text not null references mcp_oauth_clients(client_id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  access_token_hash   text not null unique,
  refresh_token_hash  text unique,
  expires_at          timestamptz not null,
  refresh_expires_at  timestamptz,
  revoked_at          timestamptz,
  last_used_at        timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists idx_mcp_tokens_user on mcp_oauth_tokens(user_id, revoked_at);

-- ---------------------------------------------------------------------------
-- 4. RLS
--
-- As rotas de OAuth usam service role e passam por cima disto. As policies
-- existem para a tela de /settings, que roda com a sessão do usuário: ele
-- precisa ver e revogar as PRÓPRIAS conexões, e nada além disso.
--
-- codes não ganha policy nenhuma: RLS ligada sem policy nega tudo que não seja
-- service role, que é exatamente o acesso que um authorization code deve ter.
-- ---------------------------------------------------------------------------
alter table mcp_oauth_clients enable row level security;
alter table mcp_oauth_codes   enable row level security;
alter table mcp_oauth_tokens  enable row level security;

create policy mcp_tokens_select on mcp_oauth_tokens for select
  using (user_id = auth.uid());

-- Só revogar. O usuário não reescreve validade nem troca o dono do token.
create policy mcp_tokens_revoke on mcp_oauth_tokens for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- O nome do cliente aparece na lista de conexões; sem isto a tela mostraria id.
create policy mcp_clients_select on mcp_oauth_clients for select
  using (auth.uid() is not null);

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
-- begin;
--   drop table if exists mcp_oauth_tokens;
--   drop table if exists mcp_oauth_codes;
--   drop table if exists mcp_oauth_clients;
-- commit;
-- ---------------------------------------------------------------------------
