# Servidor MCP do CRMFlash — Fatia 2 (OAuth 2.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o token de desenvolvimento por OAuth 2.1 com PKCE, para que o claude.ai (web e celular) conecte no `/api/mcp` — e nada além do corpo de `resolveIdentity` mude nas 14 tools.

**Architecture:** O CRMFlash não vira provedor de identidade. O Supabase Auth continua sendo o login; o app só emite **tokens de acesso ao MCP** em cima de uma sessão de navegador que já existe. Três tabelas guardam clientes, codes e tokens — tokens sempre hasheados. A tela de consentimento é uma página protegida pelo middleware, e é o próprio middleware que manda para o `/login` quando não há sessão.

**Tech Stack:** Next.js 16 route handlers + um server component, `crypto` do Node (sha256, randomBytes), Supabase service role para o plano de controle, vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-27-mcp-crmflash-design.md`, seção "Fatia 2 — OAuth 2.1". Em conflito, a spec vence.
- **Migration `016`.** O `015` foi usado pelo `dedup_key` do import.
- **PKCE `S256` obrigatório.** É OAuth 2.1, não opcional. `plain` é recusado.
- **Cliente público, sem `client_secret`.** O claude.ai roda o fluxo com PKCE; guardar segredo de cliente não acrescenta segurança e acrescenta vazamento.
- **Nada de token em claro no banco.** Só `sha256` hex. Vazar a tabela não pode virar acesso.
- **Access token de 1h, refresh rotativo.** Usar um refresh token invalida o anterior.
- Comentários e commits em português; código e identificadores em inglês.
- Testes: `npx vitest run <arquivo>`. Verificação de RLS: script em `scripts/`, como os dois que já existem.
- URL de produção: `https://crmflash.vercel.app`.
- **As 14 tools não são tocadas.** Se um arquivo em `src/lib/mcp/tools/` aparecer no diff, algo saiu do lugar.

## File Structure

**Criar**

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/016_mcp_oauth.sql` | `mcp_oauth_clients`, `mcp_oauth_codes`, `mcp_oauth_tokens` + RLS |
| `src/lib/oauth/crypto.ts` | `randomToken`, `hashToken`, `verifyPkce` |
| `src/lib/oauth/store.ts` | Acesso às três tabelas com service role |
| `src/app/.well-known/oauth-protected-resource/route.ts` | RFC 9728 |
| `src/app/.well-known/oauth-authorization-server/route.ts` | RFC 8414 |
| `src/app/api/oauth/register/route.ts` | RFC 7591 |
| `src/app/oauth/authorize/page.tsx` | Tela de consentimento (precisa de sessão) |
| `src/app/api/oauth/approve/route.ts` | Emite o code e devolve ao cliente |
| `src/app/api/oauth/token/route.ts` | `authorization_code` + `refresh_token` |
| `src/app/api/oauth/revoke/route.ts` | RFC 7009 |
| `src/components/settings/mcp-connections-card.tsx` | Conexões ativas + revogar |
| `src/hooks/use-mcp-connections.ts` | Lista e revoga, pelo cliente |
| `scripts/verify-oauth-flow.mjs` | Conformidade ponta a ponta |

**Modificar**

| Arquivo | Mudança |
|---|---|
| `src/lib/mcp/identity.ts` | `resolveIdentity` passa a aceitar token OAuth |
| `src/middleware.ts` | Isenta as rotas OAuth; preserva query string no redirect de login |
| `src/app/(dashboard)/settings/page.tsx` | Monta o card de conexões |
| `src/types/database.ts` | Tipos das três tabelas |

---

## Task 1: Migration 016 — as três tabelas

**Files:**
- Create: `supabase/migrations/016_mcp_oauth.sql`
- Modify: `src/types/database.ts`

**Interfaces:**
- Consumes: `current_workspace()` da migration 010.
- Produces: tabelas `mcp_oauth_clients`, `mcp_oauth_codes`, `mcp_oauth_tokens`; tipos `McpOAuthClient`, `McpOAuthToken`.

- [ ] **Step 1: Escrever a migration**

`supabase/migrations/016_mcp_oauth.sql`:

```sql
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
```

- [ ] **Step 2: Rodar no SQL Editor do Supabase**

Cole o arquivo inteiro no SQL Editor e execute. É manual, como a 015.

- [ ] **Step 3: Confirmar que as três tabelas existem**

```bash
node --env-file=.env.local -e "
const U=process.env.NEXT_PUBLIC_SUPABASE_URL,S=process.env.SUPABASE_SERVICE_ROLE_KEY;
const h={apikey:S,Authorization:'Bearer '+S};
(async()=>{
  for (const t of ['mcp_oauth_clients','mcp_oauth_codes','mcp_oauth_tokens']) {
    const r=await fetch(U+'/rest/v1/'+t+'?select=*&limit=1',{headers:h});
    console.log(t+':', r.ok?'ok':'FALTA (HTTP '+r.status+')');
  }
})();
"
```

Expected: as três com `ok`. Qualquer `FALTA` é bloqueante — a migration não rodou inteira.

- [ ] **Step 4: Acrescentar os tipos**

No fim de `src/types/database.ts`:

```ts
export interface McpOAuthClient {
  client_id: string
  client_name: string
  redirect_uris: string[]
  created_at: string
}

export interface McpOAuthToken {
  id: string
  client_id: string
  user_id: string
  workspace_id: string
  expires_at: string
  refresh_expires_at: string | null
  revoked_at: string | null
  last_used_at: string | null
  created_at: string
}
```

Os campos `*_hash` ficam de fora de propósito: nenhum código do cliente tem o que fazer com eles, e tipá-los convidaria a selecioná-los.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/016_mcp_oauth.sql src/types/database.ts
git commit -m "feat(oauth): tabelas de cliente, code e token do MCP"
```

---

## Task 2: Cripto do OAuth

**Files:**
- Create: `src/lib/oauth/crypto.ts`
- Test: `src/lib/oauth/crypto.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `randomToken(bytes?: number): string` — base64url
  - `hashToken(token: string): string` — sha256 hex
  - `verifyPkce(verifier: string, challenge: string): boolean`

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/oauth/crypto.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { createHash, randomBytes } from "crypto"
import { randomToken, hashToken, verifyPkce } from "./crypto"

describe("randomToken", () => {
  it("gera valores diferentes a cada chamada", () => {
    const seen = new Set(Array.from({ length: 100 }, () => randomToken()))
    expect(seen.size).toBe(100)
  })

  it("é base64url — seguro em URL e header", () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe("hashToken", () => {
  it("é sha256 hex do valor", () => {
    const expected = createHash("sha256").update("abc").digest("hex")
    expect(hashToken("abc")).toBe(expected)
  })

  it("é determinístico e distingue valores próximos", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"))
    expect(hashToken("abc")).not.toBe(hashToken("abd"))
  })
})

describe("verifyPkce", () => {
  it("aceita o par correto", () => {
    const verifier = randomBytes(32).toString("base64url")
    const challenge = createHash("sha256").update(verifier).digest("base64url")
    expect(verifyPkce(verifier, challenge)).toBe(true)
  })

  it("recusa verifier errado", () => {
    const challenge = createHash("sha256").update("certo").digest("base64url")
    expect(verifyPkce("errado", challenge)).toBe(false)
  })

  it("recusa challenge vazio", () => {
    expect(verifyPkce("qualquer", "")).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/oauth/crypto.test.ts`
Expected: FAIL — `Failed to resolve import "./crypto"`

- [ ] **Step 3: Implementar**

`src/lib/oauth/crypto.ts`:

```ts
import { createHash, randomBytes, timingSafeEqual } from "crypto"

/** Token opaco. 32 bytes = 256 bits, o mesmo porte de um segredo de sessão. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url")
}

// O banco guarda só isto. Vazar a tabela não pode virar acesso, e um hash sem
// salt basta: o valor de entrada já é aleatório de 256 bits, então não há
// dicionário para atacar.
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/**
 * PKCE S256: challenge = base64url(sha256(verifier)).
 *
 * É o que amarra quem pediu o code a quem o troca por token. Sem isso, um code
 * interceptado no redirect vale para qualquer um.
 */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false

  const computed = createHash("sha256").update(verifier).digest("base64url")
  const a = Buffer.from(computed)
  const b = Buffer.from(challenge)
  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/oauth/crypto.test.ts`
Expected: PASS — 7 testes

- [ ] **Step 5: Commit**

```bash
git add src/lib/oauth/crypto.ts src/lib/oauth/crypto.test.ts
git commit -m "feat(oauth): token opaco, hash e verificacao de PKCE"
```

---

## Task 3: Store — acesso às três tabelas

**Files:**
- Create: `src/lib/oauth/store.ts`
- Test: `src/lib/oauth/store.test.ts`

**Interfaces:**
- Consumes: `randomToken`, `hashToken` da Task 2; `fakeSupabase` de `@/lib/mcp/fake-supabase`.
- Produces:
  - `adminClient(): SupabaseClient`
  - `registerClient(name: string, redirectUris: string[]): Promise<{ client_id: string }>`
  - `getClient(clientId: string): Promise<McpOAuthClient | null>`
  - `issueCode(params: IssueCodeParams): Promise<string>`
  - `consumeCode(code: string): Promise<CodeRecord | null>`
  - `issueTokens(params: IssueTokensParams): Promise<TokenPair>`
  - `rotateRefresh(refreshToken: string): Promise<TokenPair | null>`
  - `lookupAccessToken(accessToken: string): Promise<{ userId: string; workspaceId: string } | null>`
  - `revokeToken(token: string): Promise<void>`

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/oauth/store.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { buildCodeRow, buildTokenRows, isUsable } from "./store"
import { hashToken } from "./crypto"

const NOW = new Date("2026-08-27T12:00:00Z")

describe("buildCodeRow", () => {
  it("guarda o hash do code, nunca o code", () => {
    const { code, row } = buildCodeRow(
      {
        clientId: "cli-1",
        userId: "user-1",
        workspaceId: "ws-1",
        redirectUri: "https://claude.ai/cb",
        codeChallenge: "challenge",
      },
      NOW
    )

    expect(row.code_hash).toBe(hashToken(code))
    expect(JSON.stringify(row)).not.toContain(code)
  })

  it("expira em 60 segundos", () => {
    const { row } = buildCodeRow(
      {
        clientId: "cli-1",
        userId: "user-1",
        workspaceId: "ws-1",
        redirectUri: "https://claude.ai/cb",
        codeChallenge: "challenge",
      },
      NOW
    )

    expect(new Date(row.expires_at).getTime() - NOW.getTime()).toBe(60_000)
  })
})

describe("buildTokenRows", () => {
  it("guarda os dois hashes e nenhum valor em claro", () => {
    const { accessToken, refreshToken, row } = buildTokenRows(
      { clientId: "cli-1", userId: "user-1", workspaceId: "ws-1" },
      NOW
    )

    expect(row.access_token_hash).toBe(hashToken(accessToken))
    expect(row.refresh_token_hash).toBe(hashToken(refreshToken))
    expect(JSON.stringify(row)).not.toContain(accessToken)
    expect(JSON.stringify(row)).not.toContain(refreshToken)
  })

  it("access vale 1h e refresh vale 30 dias", () => {
    const { row } = buildTokenRows(
      { clientId: "cli-1", userId: "user-1", workspaceId: "ws-1" },
      NOW
    )

    expect(new Date(row.expires_at).getTime() - NOW.getTime()).toBe(3600_000)
    expect(new Date(row.refresh_expires_at).getTime() - NOW.getTime()).toBe(
      30 * 24 * 3600_000
    )
  })
})

describe("isUsable", () => {
  const future = new Date(NOW.getTime() + 1000).toISOString()
  const past = new Date(NOW.getTime() - 1000).toISOString()

  it("aceita token vivo e não revogado", () => {
    expect(isUsable({ expires_at: future, revoked_at: null }, NOW)).toBe(true)
  })

  it("recusa token expirado", () => {
    expect(isUsable({ expires_at: past, revoked_at: null }, NOW)).toBe(false)
  })

  it("recusa token revogado, mesmo dentro da validade", () => {
    expect(isUsable({ expires_at: future, revoked_at: past }, NOW)).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/oauth/store.test.ts`
Expected: FAIL — `Failed to resolve import "./store"`

- [ ] **Step 3: Implementar**

`src/lib/oauth/store.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { McpOAuthClient } from "@/types/database"
import { randomToken, hashToken } from "./crypto"

const CODE_TTL_MS = 60_000
const ACCESS_TTL_MS = 3600_000
const REFRESH_TTL_MS = 30 * 24 * 3600_000

/**
 * Service role de propósito: as rotas de OAuth rodam ANTES de existir sessão —
 * é o fluxo que cria o acesso. Não há auth.uid() para a RLS escopar, e por isso
 * cada consulta aqui filtra explicitamente.
 */
export function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

export interface IssueCodeParams {
  clientId: string
  userId: string
  workspaceId: string
  redirectUri: string
  codeChallenge: string
}

// Separada da escrita para ser testável sem banco: é aqui que mora a regra de
// "guarda o hash, devolve o valor", que é o que não pode dar errado.
export function buildCodeRow(params: IssueCodeParams, now = new Date()) {
  const code = randomToken()
  return {
    code,
    row: {
      code_hash: hashToken(code),
      client_id: params.clientId,
      user_id: params.userId,
      workspace_id: params.workspaceId,
      redirect_uri: params.redirectUri,
      code_challenge: params.codeChallenge,
      code_challenge_method: "S256",
      expires_at: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
    },
  }
}

export interface IssueTokensParams {
  clientId: string
  userId: string
  workspaceId: string
}

export function buildTokenRows(params: IssueTokensParams, now = new Date()) {
  const accessToken = randomToken()
  const refreshToken = randomToken()
  return {
    accessToken,
    refreshToken,
    row: {
      client_id: params.clientId,
      user_id: params.userId,
      workspace_id: params.workspaceId,
      access_token_hash: hashToken(accessToken),
      refresh_token_hash: hashToken(refreshToken),
      expires_at: new Date(now.getTime() + ACCESS_TTL_MS).toISOString(),
      refresh_expires_at: new Date(now.getTime() + REFRESH_TTL_MS).toISOString(),
    },
  }
}

export function isUsable(
  row: { expires_at: string; revoked_at: string | null },
  now = new Date()
): boolean {
  if (row.revoked_at) return false
  return new Date(row.expires_at).getTime() > now.getTime()
}

export async function registerClient(
  name: string,
  redirectUris: string[]
): Promise<{ client_id: string }> {
  const clientId = randomToken(16)
  const { error } = await adminClient()
    .from("mcp_oauth_clients")
    .insert({ client_id: clientId, client_name: name, redirect_uris: redirectUris })

  if (error) throw new Error(`Não consegui registrar o cliente: ${error.message}`)
  return { client_id: clientId }
}

export async function getClient(clientId: string): Promise<McpOAuthClient | null> {
  const { data } = await adminClient()
    .from("mcp_oauth_clients")
    .select("client_id, client_name, redirect_uris, created_at")
    .eq("client_id", clientId)
    .maybeSingle()

  return (data as McpOAuthClient) ?? null
}

export async function issueCode(params: IssueCodeParams): Promise<string> {
  const { code, row } = buildCodeRow(params)
  const { error } = await adminClient().from("mcp_oauth_codes").insert(row)
  if (error) throw new Error(`Não consegui emitir o code: ${error.message}`)
  return code
}

export interface CodeRecord {
  client_id: string
  user_id: string
  workspace_id: string
  redirect_uri: string
  code_challenge: string
}

/**
 * Marca o code como usado e devolve o que ele autorizava. Devolve null se já
 * foi usado ou expirou — code é de uso único, e reapresentação é sinal de
 * vazamento, não de retry.
 */
export async function consumeCode(code: string): Promise<CodeRecord | null> {
  const supabase = adminClient()
  const hash = hashToken(code)

  const { data } = await supabase
    .from("mcp_oauth_codes")
    .select("client_id, user_id, workspace_id, redirect_uri, code_challenge, expires_at, consumed_at")
    .eq("code_hash", hash)
    .maybeSingle()

  if (!data) return null
  if (data.consumed_at) return null
  if (new Date(data.expires_at).getTime() <= Date.now()) return null

  await supabase
    .from("mcp_oauth_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("code_hash", hash)

  return {
    client_id: data.client_id,
    user_id: data.user_id,
    workspace_id: data.workspace_id,
    redirect_uri: data.redirect_uri,
    code_challenge: data.code_challenge,
  }
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export async function issueTokens(params: IssueTokensParams): Promise<TokenPair> {
  const { accessToken, refreshToken, row } = buildTokenRows(params)
  const { error } = await adminClient().from("mcp_oauth_tokens").insert(row)
  if (error) throw new Error(`Não consegui emitir o token: ${error.message}`)

  return { accessToken, refreshToken, expiresIn: ACCESS_TTL_MS / 1000 }
}

/**
 * Refresh rotativo: usar o refresh revoga o par inteiro e emite outro. Se um
 * refresh vazado for usado, o legítimo para de funcionar na próxima renovação —
 * que é como o dono descobre.
 */
export async function rotateRefresh(refreshToken: string): Promise<TokenPair | null> {
  const supabase = adminClient()
  const hash = hashToken(refreshToken)

  const { data } = await supabase
    .from("mcp_oauth_tokens")
    .select("id, client_id, user_id, workspace_id, refresh_expires_at, revoked_at")
    .eq("refresh_token_hash", hash)
    .maybeSingle()

  if (!data) return null
  if (data.revoked_at) return null
  if (!data.refresh_expires_at) return null
  if (new Date(data.refresh_expires_at).getTime() <= Date.now()) return null

  await supabase
    .from("mcp_oauth_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", data.id)

  return issueTokens({
    clientId: data.client_id,
    userId: data.user_id,
    workspaceId: data.workspace_id,
  })
}

export async function lookupAccessToken(
  accessToken: string
): Promise<{ userId: string; workspaceId: string } | null> {
  const supabase = adminClient()
  const hash = hashToken(accessToken)

  const { data } = await supabase
    .from("mcp_oauth_tokens")
    .select("id, user_id, workspace_id, expires_at, revoked_at")
    .eq("access_token_hash", hash)
    .maybeSingle()

  if (!data || !isUsable(data)) return null

  // Alimenta a coluna "último uso" da tela de conexões. Sem await: o usuário
  // não deve esperar por telemetria.
  void supabase
    .from("mcp_oauth_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)

  return { userId: data.user_id, workspaceId: data.workspace_id }
}

/** RFC 7009: revoga por access OU refresh, e não diz qual dos dois era. */
export async function revokeToken(token: string): Promise<void> {
  const supabase = adminClient()
  const hash = hashToken(token)
  const now = new Date().toISOString()

  await supabase.from("mcp_oauth_tokens").update({ revoked_at: now }).eq("access_token_hash", hash)
  await supabase.from("mcp_oauth_tokens").update({ revoked_at: now }).eq("refresh_token_hash", hash)
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/oauth/store.test.ts`
Expected: PASS — 7 testes

- [ ] **Step 5: Commit**

```bash
git add src/lib/oauth/store.ts src/lib/oauth/store.test.ts
git commit -m "feat(oauth): store de clientes, codes e tokens"
```

---

## Task 4: Metadata de descoberta

**Files:**
- Create: `src/app/.well-known/oauth-protected-resource/route.ts`, `src/app/.well-known/oauth-authorization-server/route.ts`
- Modify: `src/middleware.ts`

**Interfaces:**
- Consumes: nada.
- Produces: dois endpoints GET públicos.

- [ ] **Step 1: Isentar as rotas OAuth do middleware**

Em `src/middleware.ts`, o array `publicRoutes` passa a incluir as rotas que **não** têm cookie de sessão. `/oauth/authorize` fica **de fora** de propósito: ela precisa da sessão, e o redirect para `/login` é justamente o comportamento desejado.

```ts
const publicRoutes = [
  '/login',
  '/signup',
  '/auth/callback',
  '/api/integration',
  '/api/mcp',
  '/.well-known/',
  '/api/oauth/',
]
```

- [ ] **Step 2: Preservar a query string no redirect de login**

Sem isto o fluxo OAuth quebra no meio: o middleware manda para `/login?redirect=/oauth/authorize` **sem** `client_id`, `state` nem `code_challenge`, e ao voltar a página de consentimento não sabe mais o que estava sendo autorizado.

Em `src/middleware.ts`, linha ~52:

```ts
// Antes
url.searchParams.set('redirect', pathname)

// Depois — `search` inclui o "?" quando existe, e é vazio quando não.
url.searchParams.set('redirect', pathname + request.nextUrl.search)
```

`sanitizeRedirect` já aceita isso: ele só exige começar com `/` e não com `//`.

- [ ] **Step 3: Escrever o metadata do recurso (RFC 9728)**

`src/app/.well-known/oauth-protected-resource/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"

// RFC 9728. É o que o cliente MCP busca depois de tomar 401 do /api/mcp: o
// header WWW-Authenticate aponta para cá, e daqui ele descobre quem autoriza.
export async function GET(request: NextRequest) {
  const origin = new URL(request.url).origin

  return NextResponse.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
  })
}
```

- [ ] **Step 4: Escrever o metadata do autorizador (RFC 8414)**

`src/app/.well-known/oauth-authorization-server/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"

// RFC 8414. Sem client_secret em lugar nenhum: cliente público com PKCE.
export async function GET(request: NextRequest) {
  const origin = new URL(request.url).origin

  return NextResponse.json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  })
}
```

- [ ] **Step 5: Verificar que o Next serve pastas com ponto**

Com `npm run dev` rodando (confira a porta no output):

```bash
curl -s localhost:3000/.well-known/oauth-authorization-server | head -c 200
```

Expected: o JSON acima.

**Se vier 404**, o Next não está roteando a pasta `.well-known`. Nesse caso mova os dois arquivos para `src/app/api/well-known/oauth-authorization-server/route.ts` e `.../oauth-protected-resource/route.ts` e acrescente os rewrites em `next.config.ts`, dentro do objeto `nextConfig`:

```ts
  async rewrites() {
    return [
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/api/well-known/oauth-authorization-server",
      },
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/api/well-known/oauth-protected-resource",
      },
    ]
  },
```

Depois repita o curl e confirme o JSON.

- [ ] **Step 6: Confirmar que o 401 do MCP aponta para o metadata**

```bash
curl -s -D - -o /dev/null -X POST localhost:3000/api/mcp \
  -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | grep -i www-authenticate
```

Expected: `www-authenticate: Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"` — e essa URL tem que responder o JSON do Step 5.

- [ ] **Step 7: Commit**

```bash
git add src/app/.well-known src/middleware.ts next.config.ts
git commit -m "feat(oauth): metadata de descoberta e isencao de middleware"
```

---

## Task 5: Registro dinâmico de cliente

**Files:**
- Create: `src/app/api/oauth/register/route.ts`
- Test: `src/lib/oauth/register.test.ts`

**Interfaces:**
- Consumes: `registerClient` da Task 3.
- Produces: `POST /api/oauth/register`; `validateRegistration(body: unknown)` exportada para teste.

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/oauth/register.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { validateRegistration } from "@/app/api/oauth/register/route"

describe("validateRegistration", () => {
  it("aceita um registro bem formado", () => {
    const out = validateRegistration({
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
    })
    expect(out.ok).toBe(true)
  })

  it("recusa sem redirect_uris", () => {
    expect(validateRegistration({ client_name: "Claude" }).ok).toBe(false)
  })

  it("recusa redirect_uri que não é https", () => {
    const out = validateRegistration({
      client_name: "Claude",
      redirect_uris: ["http://evil.example/cb"],
    })
    expect(out.ok).toBe(false)
  })

  it("aceita http em localhost — é o caso de desenvolvimento", () => {
    const out = validateRegistration({
      client_name: "Claude",
      redirect_uris: ["http://localhost:5173/cb"],
    })
    expect(out.ok).toBe(true)
  })

  it("recusa redirect_uri com fragmento", () => {
    const out = validateRegistration({
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/cb#x"],
    })
    expect(out.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/oauth/register.test.ts`
Expected: FAIL — módulo não resolve

- [ ] **Step 3: Implementar**

`src/app/api/oauth/register/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { registerClient } from "@/lib/oauth/store"
import { rateLimit, rateLimitKey } from "@/lib/rate-limit"

export interface RegistrationResult {
  ok: boolean
  error?: string
  client_name?: string
  redirect_uris?: string[]
}

/**
 * RFC 7591. Registro é aberto por necessidade — o claude.ai precisa se
 * cadastrar sozinho — mas o que ele registra é validado: um redirect_uri é
 * para onde um authorization code será entregue, e aceitar qualquer coisa aqui
 * transformaria o endpoint num redirecionador de codes.
 */
export function validateRegistration(body: unknown): RegistrationResult {
  const b = body as { client_name?: unknown; redirect_uris?: unknown }

  const name = typeof b?.client_name === "string" ? b.client_name.trim() : ""
  if (!name) return { ok: false, error: "client_name é obrigatório" }

  if (!Array.isArray(b?.redirect_uris) || b.redirect_uris.length === 0) {
    return { ok: false, error: "redirect_uris é obrigatório" }
  }

  const uris: string[] = []
  for (const raw of b.redirect_uris) {
    if (typeof raw !== "string") return { ok: false, error: "redirect_uri inválido" }

    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return { ok: false, error: `redirect_uri inválido: ${raw}` }
    }

    // Fragmento é proibido pela RFC 6749 §3.1.2 — e é por onde se esconde
    // destino alternativo num URI que parece legítimo.
    if (url.hash) return { ok: false, error: "redirect_uri não pode ter fragmento" }

    const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1"
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost)) {
      return { ok: false, error: "redirect_uri precisa ser https (ou http em localhost)" }
    }

    uris.push(raw)
  }

  return { ok: true, client_name: name, redirect_uris: uris }
}

export async function POST(request: NextRequest) {
  const rl = rateLimit(rateLimitKey(request, "oauth-register"), {
    limit: 10,
    windowMs: 60_000,
  })
  if (!rl.success) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_client_metadata" }, { status: 400 })
  }

  const parsed = validateRegistration(body)
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "invalid_client_metadata", error_description: parsed.error },
      { status: 400 }
    )
  }

  const { client_id } = await registerClient(parsed.client_name!, parsed.redirect_uris!)

  return NextResponse.json(
    {
      client_id,
      client_name: parsed.client_name,
      redirect_uris: parsed.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { status: 201 }
  )
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/oauth/register.test.ts`
Expected: PASS — 5 testes

- [ ] **Step 5: Verificar contra o banco**

```bash
curl -s -X POST localhost:3000/api/oauth/register \
  -H 'content-type: application/json' \
  -d '{"client_name":"Sonda","redirect_uris":["https://claude.ai/api/mcp/auth_callback"]}'
```

Expected: 201 com `client_id`. Guarde o valor para a Task 6.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/oauth/register src/lib/oauth/register.test.ts
git commit -m "feat(oauth): registro dinamico de cliente"
```

---

## Task 6: Consentimento e emissão do code

**Files:**
- Create: `src/app/oauth/authorize/page.tsx`, `src/app/api/oauth/approve/route.ts`
- Test: `src/lib/oauth/authorize.test.ts`

**Interfaces:**
- Consumes: `getClient`, `issueCode` da Task 3; `createServerSupabaseClient` de `@/lib/supabase/server`; `getWorkspaceId` de `@/lib/workspace/server`.
- Produces: página `/oauth/authorize`; `POST /api/oauth/approve`; `validateAuthorizeParams(params: URLSearchParams, client: McpOAuthClient | null)`.

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/oauth/authorize.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { validateAuthorizeParams } from "@/app/api/oauth/approve/route"
import type { McpOAuthClient } from "@/types/database"

const CLIENT: McpOAuthClient = {
  client_id: "cli-1",
  client_name: "Claude",
  redirect_uris: ["https://claude.ai/cb"],
  created_at: "2026-08-27T00:00:00Z",
}

function params(over: Record<string, string> = {}) {
  return new URLSearchParams({
    client_id: "cli-1",
    redirect_uri: "https://claude.ai/cb",
    response_type: "code",
    code_challenge: "abc",
    code_challenge_method: "S256",
    state: "xyz",
    ...over,
  })
}

describe("validateAuthorizeParams", () => {
  it("aceita um pedido bem formado", () => {
    expect(validateAuthorizeParams(params(), CLIENT).ok).toBe(true)
  })

  it("recusa cliente desconhecido", () => {
    expect(validateAuthorizeParams(params(), null).ok).toBe(false)
  })

  it("recusa redirect_uri que não foi registrado", () => {
    const out = validateAuthorizeParams(
      params({ redirect_uri: "https://claude.ai/outro" }),
      CLIENT
    )
    expect(out.ok).toBe(false)
  })

  it("recusa PKCE plain — é OAuth 2.1", () => {
    const out = validateAuthorizeParams(
      params({ code_challenge_method: "plain" }),
      CLIENT
    )
    expect(out.ok).toBe(false)
  })

  it("recusa pedido sem code_challenge", () => {
    const p = params()
    p.delete("code_challenge")
    expect(validateAuthorizeParams(p, CLIENT).ok).toBe(false)
  })

  it("recusa response_type diferente de code", () => {
    expect(validateAuthorizeParams(params({ response_type: "token" }), CLIENT).ok).toBe(
      false
    )
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/oauth/authorize.test.ts`
Expected: FAIL — módulo não resolve

- [ ] **Step 3: Implementar a validação e o approve**

`src/app/api/oauth/approve/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getWorkspaceId } from "@/lib/workspace/server"
import { getClient, issueCode } from "@/lib/oauth/store"
import { verifyCsrfOrigin } from "@/lib/utils"
import type { McpOAuthClient } from "@/types/database"

export interface AuthorizeParams {
  ok: boolean
  error?: string
  clientId?: string
  redirectUri?: string
  codeChallenge?: string
  state?: string
}

/**
 * Valida o pedido de autorização.
 *
 * A checagem de redirect_uri é por igualdade exata contra o que o cliente
 * registrou — não prefixo. Prefixo deixaria `https://claude.ai/cb.evil.com`
 * passar por `https://claude.ai/cb`, e o code iria para o lugar errado.
 */
export function validateAuthorizeParams(
  params: URLSearchParams,
  client: McpOAuthClient | null
): AuthorizeParams {
  if (!client) return { ok: false, error: "cliente desconhecido" }

  const redirectUri = params.get("redirect_uri") ?? ""
  if (!client.redirect_uris.includes(redirectUri)) {
    return { ok: false, error: "redirect_uri não registrado para este cliente" }
  }

  if (params.get("response_type") !== "code") {
    return { ok: false, error: "response_type precisa ser code" }
  }

  const codeChallenge = params.get("code_challenge") ?? ""
  if (!codeChallenge) return { ok: false, error: "code_challenge é obrigatório" }

  if ((params.get("code_challenge_method") ?? "") !== "S256") {
    return { ok: false, error: "code_challenge_method precisa ser S256" }
  }

  return {
    ok: true,
    clientId: client.client_id,
    redirectUri,
    codeChallenge,
    state: params.get("state") ?? undefined,
  }
}

export async function POST(request: NextRequest) {
  // CSRF: esta rota é um POST autenticado por COOKIE que emite um
  // authorization code. Sem esta checagem, qualquer site poderia postar um
  // formulário com o client_id dele e sair com um code válido do usuário
  // logado, sem nenhum clique consciente. verifyCsrfOrigin já existe no repo.
  if (!verifyCsrfOrigin(request)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 403 })
  }

  const form = await request.formData()
  const params = new URLSearchParams()
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") params.set(k, v)
  }

  // A sessão do navegador é o que prova QUEM está autorizando. Sem ela não há
  // o que aprovar — e ela chega aqui pelo cookie, não pelo formulário.
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const workspaceId = await getWorkspaceId(supabase, user.id)
  if (!workspaceId) {
    return NextResponse.json({ error: "sem workspace" }, { status: 400 })
  }

  const client = await getClient(params.get("client_id") ?? "")
  const parsed = validateAuthorizeParams(params, client)
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "invalid_request", error_description: parsed.error },
      { status: 400 }
    )
  }

  const code = await issueCode({
    clientId: parsed.clientId!,
    userId: user.id,
    workspaceId,
    redirectUri: parsed.redirectUri!,
    codeChallenge: parsed.codeChallenge!,
  })

  const target = new URL(parsed.redirectUri!)
  target.searchParams.set("code", code)
  if (parsed.state) target.searchParams.set("state", parsed.state)

  return NextResponse.redirect(target, { status: 303 })
}
```

- [ ] **Step 4: Implementar a tela de consentimento**

`src/app/oauth/authorize/page.tsx`:

```tsx
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getClient } from "@/lib/oauth/store"
import { validateAuthorizeParams } from "@/app/api/oauth/approve/route"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") params.set(k, v)
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const client = await getClient(params.get("client_id") ?? "")
  const parsed = validateAuthorizeParams(params, client)

  if (!parsed.ok) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Pedido inválido</CardTitle>
            <CardDescription>{parsed.error}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Conectar {client!.client_name} ao CRMFlash</CardTitle>
          <CardDescription>
            Autorizando como {user?.email}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 text-sm">
            <p className="font-medium">Esta conexão vai poder:</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Ler seu pipeline, empresas, pessoas e próximos passos</li>
              <li>Registrar atividades, próximos passos e sinais</li>
              <li>Mover empresas de estágio no funil</li>
              <li>Cadastrar empresa ou pessoa nova</li>
            </ul>
            <p className="pt-2 font-medium">Não vai poder:</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Apagar nada</li>
              <li>Ver dados de outro workspace</li>
            </ul>
          </div>

          <form method="POST" action="/api/oauth/approve" className="space-y-2">
            {[...params.entries()].map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <Button type="submit" className="w-full">
              Autorizar
            </Button>
          </form>

          <p className="text-center text-xs text-muted-foreground">
            Você pode revogar a qualquer momento em Configurações.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/oauth/authorize.test.ts`
Expected: PASS — 6 testes

- [ ] **Step 6: Verificar o redirect de login com query preservada**

Numa janela anônima, abra:

```
http://localhost:3000/oauth/authorize?client_id=<o da Task 5>&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&response_type=code&code_challenge=abc&code_challenge_method=S256&state=xyz
```

Expected: cai no `/login` e, **depois de entrar**, volta para a tela de consentimento com o nome do cliente — não para o `/dashboard`. Se voltar para o dashboard, o Step 2 da Task 4 não foi aplicado.

- [ ] **Step 7: Confirmar que o approve recusa origem estranha**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/api/oauth/approve \
  -H 'Origin: https://evil.example' \
  -d client_id=x -d redirect_uri=https://claude.ai/cb -d response_type=code \
  -d code_challenge=abc -d code_challenge_method=S256
```

Expected: `403`. Se vier 400 ou 401, a checagem de origem não está antes da
validação — e a rota está aberta a CSRF.

- [ ] **Step 8: Commit**

```bash
git add src/app/oauth src/app/api/oauth/approve src/lib/oauth/authorize.test.ts
git commit -m "feat(oauth): tela de consentimento e emissao do code"
```

---

## Task 7: Token e revogação

**Files:**
- Create: `src/app/api/oauth/token/route.ts`, `src/app/api/oauth/revoke/route.ts`

**Interfaces:**
- Consumes: `consumeCode`, `issueTokens`, `rotateRefresh`, `revokeToken` da Task 3; `verifyPkce` da Task 2.
- Produces: `POST /api/oauth/token`, `POST /api/oauth/revoke`.

- [ ] **Step 1: Implementar o token endpoint**

`src/app/api/oauth/token/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { consumeCode, issueTokens, rotateRefresh } from "@/lib/oauth/store"
import { verifyPkce } from "@/lib/oauth/crypto"
import { rateLimit, rateLimitKey } from "@/lib/rate-limit"

function oauthError(error: string, description: string, status = 400) {
  return NextResponse.json({ error, error_description: description }, { status })
}

export async function POST(request: NextRequest) {
  const rl = rateLimit(rateLimitKey(request, "oauth-token"), { limit: 30, windowMs: 60_000 })
  if (!rl.success) return oauthError("temporarily_unavailable", "muitas tentativas", 429)

  const form = await request.formData()
  const grant = String(form.get("grant_type") ?? "")

  if (grant === "refresh_token") {
    const refresh = String(form.get("refresh_token") ?? "")
    const pair = await rotateRefresh(refresh)
    if (!pair) return oauthError("invalid_grant", "refresh token inválido ou expirado")

    return NextResponse.json({
      access_token: pair.accessToken,
      refresh_token: pair.refreshToken,
      token_type: "Bearer",
      expires_in: pair.expiresIn,
    })
  }

  if (grant !== "authorization_code") {
    return oauthError("unsupported_grant_type", `grant_type não suportado: ${grant}`)
  }

  const code = String(form.get("code") ?? "")
  const verifier = String(form.get("code_verifier") ?? "")
  const clientId = String(form.get("client_id") ?? "")
  const redirectUri = String(form.get("redirect_uri") ?? "")

  const record = await consumeCode(code)
  if (!record) return oauthError("invalid_grant", "code inválido, expirado ou já usado")

  // As três amarrações que fazem o code valer só para quem o pediu.
  if (record.client_id !== clientId) {
    return oauthError("invalid_grant", "code não pertence a este cliente")
  }
  if (record.redirect_uri !== redirectUri) {
    return oauthError("invalid_grant", "redirect_uri diferente do usado na autorização")
  }
  if (!verifyPkce(verifier, record.code_challenge)) {
    return oauthError("invalid_grant", "code_verifier não confere")
  }

  const pair = await issueTokens({
    clientId: record.client_id,
    userId: record.user_id,
    workspaceId: record.workspace_id,
  })

  return NextResponse.json({
    access_token: pair.accessToken,
    refresh_token: pair.refreshToken,
    token_type: "Bearer",
    expires_in: pair.expiresIn,
  })
}
```

- [ ] **Step 2: Implementar a revogação**

`src/app/api/oauth/revoke/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { revokeToken } from "@/lib/oauth/store"

// RFC 7009. Responde 200 mesmo para token que não existe: dizer "esse token eu
// não conheço" transformaria o endpoint num oráculo de tokens válidos.
export async function POST(request: NextRequest) {
  const form = await request.formData()
  const token = String(form.get("token") ?? "")

  if (token) await revokeToken(token)

  return new NextResponse(null, { status: 200 })
}
```

- [ ] **Step 3: Verificar o fluxo inteiro à mão**

Com o `client_id` da Task 5 e uma sessão aberta no navegador, gere o par PKCE:

```bash
node -e "
const c=require('crypto');
const v=c.randomBytes(32).toString('base64url');
const ch=c.createHash('sha256').update(v).digest('base64url');
console.log('verifier :',v);
console.log('challenge:',ch);
"
```

Abra a URL de autorização (Task 6, Step 6) com esse `challenge`, autorize, e copie o `code` da URL de destino. Então:

```bash
curl -s -X POST localhost:3000/api/oauth/token \
  -d grant_type=authorization_code \
  -d code=<code> \
  -d code_verifier=<verifier> \
  -d client_id=<client_id> \
  -d redirect_uri=https://claude.ai/api/mcp/auth_callback
```

Expected: JSON com `access_token`, `refresh_token`, `token_type: "Bearer"`, `expires_in: 3600`.

Repita o **mesmo** curl: Expected `invalid_grant` — code é de uso único.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/oauth/token src/app/api/oauth/revoke
git commit -m "feat(oauth): token endpoint com PKCE e revogacao"
```

---

## Task 8: `resolveIdentity` aceita token OAuth

**Files:**
- Modify: `src/lib/mcp/identity.ts`, `src/lib/mcp/identity.test.ts`

**Interfaces:**
- Consumes: `lookupAccessToken` da Task 3.
- Produces: `resolveIdentity` reconhecendo token OAuth **e** o token de desenvolvimento.

- [ ] **Step 1: Escrever o teste que falha**

Acrescente em `src/lib/mcp/identity.test.ts`:

```ts
describe("prioridade de credencial", () => {
  it("token de dev só vale quando MCP_DEV_TOKEN está configurado", () => {
    delete process.env.MCP_DEV_TOKEN
    expect(matchesDevToken("qualquer-coisa")).toBe(false)

    process.env.MCP_DEV_TOKEN = "token-de-dev"
    expect(matchesDevToken("token-de-dev")).toBe(true)
    expect(matchesDevToken("outro")).toBe(false)
  })
})
```

E acrescente `matchesDevToken` ao import do topo do arquivo.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/mcp/identity.test.ts`
Expected: FAIL — `matchesDevToken` não é exportado

- [ ] **Step 3: Implementar**

Em `src/lib/mcp/identity.ts`, extraia a comparação do token de dev e acrescente o caminho OAuth. `resolveIdentity` passa a ser:

```ts
import { lookupAccessToken } from "@/lib/oauth/store"

/** Separada para teste: a comparação em tempo constante não é observável de fora. */
export function matchesDevToken(token: string): boolean {
  const expected = process.env.MCP_DEV_TOKEN
  if (!expected) return false
  return constantTimeEquals(token, expected)
}

export async function resolveIdentity(request: Request): Promise<McpIdentity | null> {
  const token = extractBearer(request)
  if (!token) return null

  // OAuth primeiro: é o caminho de produção. O token de dev é o atalho local, e
  // deixá-lo em segundo lugar garante que ele nunca sombreie um token real.
  const granted = await lookupAccessToken(token)
  if (granted) return buildIdentity(granted.userId, granted.workspaceId)

  const devUserId = process.env.MCP_DEV_USER_ID
  if (devUserId && matchesDevToken(token)) {
    const supabase = await clientForUser(devUserId)
    const workspaceId = await resolveWorkspaceId(supabase, devUserId)
    if (!workspaceId) return null
    return { userId: devUserId, workspaceId, supabase }
  }

  return null
}

async function buildIdentity(userId: string, workspaceId: string): Promise<McpIdentity> {
  return { userId, workspaceId, supabase: await clientForUser(userId) }
}

/** Cliente autenticado COMO o usuário: a RLS escopa tudo que ele fizer. */
async function clientForUser(userId: string): Promise<SupabaseClient> {
  const accessToken = await getAccessToken(userId)
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  )
}
```

O token OAuth já traz `workspace_id`, então o caminho de produção não paga a consulta a `workspace_members` — ela fica só no atalho de desenvolvimento.

- [ ] **Step 4: Rodar a suíte inteira**

Run: `npx vitest run`
Expected: PASS. As 14 tools continuam sem alteração.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Verificar com o token de verdade**

Com o `access_token` da Task 7:

```bash
curl -s -X POST localhost:3000/api/mcp \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer <access_token>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 200
```

Expected: as 14 tools. E com um token inventado: 401.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mcp/identity.ts src/lib/mcp/identity.test.ts
git commit -m "feat(oauth): MCP aceita token OAuth alem do token de dev"
```

---

## Task 9: Conexões ativas em /settings

**Files:**
- Create: `src/hooks/use-mcp-connections.ts`, `src/components/settings/mcp-connections-card.tsx`
- Modify: `src/app/(dashboard)/settings/page.tsx`

**Interfaces:**
- Consumes: RLS da Task 1 (`mcp_tokens_select`, `mcp_tokens_revoke`); `createClient` de `@/lib/supabase/client`.
- Produces: `useMcpConnections()` → `{ connections, loading, revoke }`.

- [ ] **Step 1: Implementar o hook**

`src/hooks/use-mcp-connections.ts`:

```ts
"use client"

import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

export interface McpConnection {
  id: string
  clientName: string
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string
}

export function useMcpConnections() {
  const [connections, setConnections] = useState<McpConnection[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const supabase = createClient()
    // A RLS restringe a user_id = auth.uid(); o filtro de revoked_at é o que
    // separa "conexão ativa" de histórico.
    const { data } = await supabase
      .from("mcp_oauth_tokens")
      .select("id, created_at, last_used_at, expires_at, mcp_oauth_clients(client_name)")
      .is("revoked_at", null)
      .order("created_at", { ascending: false })

    setConnections(
      (data ?? []).map((row) => ({
        id: row.id as string,
        clientName:
          (row.mcp_oauth_clients as unknown as { client_name: string } | null)?.client_name ??
          "Cliente desconhecido",
        createdAt: row.created_at as string,
        lastUsedAt: row.last_used_at as string | null,
        expiresAt: row.expires_at as string,
      }))
    )
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const revoke = useCallback(
    async (id: string) => {
      const supabase = createClient()
      const { error } = await supabase
        .from("mcp_oauth_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id)

      if (error) throw new Error(error.message)
      await load()
    },
    [load]
  )

  return { connections, loading, revoke }
}
```

- [ ] **Step 2: Implementar o card**

`src/components/settings/mcp-connections-card.tsx`:

```tsx
"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { Plug } from "lucide-react"
import { useMcpConnections } from "@/hooks/use-mcp-connections"

export function McpConnectionsCard() {
  const { connections, loading, revoke } = useMcpConnections()

  async function handleRevoke(id: string, name: string) {
    try {
      await revoke(id)
      toast.success(`Acesso de ${name} revogado.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao revogar")
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="h-4 w-4" />
          Conexões MCP
        </CardTitle>
        <CardDescription>
          Aplicativos autorizados a ler e registrar no seu pipeline.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}

        {!loading && connections.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma conexão ativa.</p>
        )}

        {connections.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{c.clientName}</p>
              <p className="text-xs text-muted-foreground">
                Autorizado em {new Date(c.createdAt).toLocaleDateString("pt-BR")}
                {c.lastUsedAt
                  ? ` · usado em ${new Date(c.lastUsedAt).toLocaleDateString("pt-BR")}`
                  : " · nunca usado"}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => handleRevoke(c.id, c.clientName)}>
              Revogar
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: Montar na página**

Em `src/app/(dashboard)/settings/page.tsx`, importar e renderizar logo abaixo de `<WorkspaceCard />`:

```tsx
import { McpConnectionsCard } from "@/components/settings/mcp-connections-card"
```

```tsx
<McpConnectionsCard />
```

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit`
Expected: sem erros.

Abra `/settings` logado. Expected: a conexão criada na Task 7 aparece com o nome do cliente. Clique em **Revogar** e confirme que some da lista — e que o `curl` da Task 8 Step 5 passa a devolver **401** com aquele mesmo token.

Esse último ponto é o que prova que a revogação vale: sem ele, o botão é decorativo.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-mcp-connections.ts src/components/settings/mcp-connections-card.tsx "src/app/(dashboard)/settings/page.tsx"
git commit -m "feat(oauth): conexoes ativas e revogacao em settings"
```

---

## Task 10: Conformidade e deploy

**Files:**
- Create: `scripts/verify-oauth-flow.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: os endpoints das Tasks 4–7.
- Produces: `npm run verify:oauth`.

- [ ] **Step 1: Escrever o verificador**

`scripts/verify-oauth-flow.mjs` roda o fluxo inteiro contra um servidor de pé, incluindo os caminhos negativos. Recebe a URL base por argumento (default `http://localhost:3000`).

```js
// Conformidade do fluxo OAuth do MCP, ponta a ponta.
//
// O caminho feliz não é o que importa aqui — ele é exercido à mão durante o
// desenvolvimento. O que este script guarda são os caminhos NEGATIVOS: PKCE
// errado, code reusado, redirect_uri divergente, token revogado. É neles que
// um servidor OAuth vira porta aberta, e nenhum deles aparece quando a
// conexão simplesmente funciona.
//
// A parte que exige sessão de navegador (a tela de consentimento) fica de
// fora: este script emite o code direto pelo banco, com service role.
import { createHash, randomBytes } from "node:crypto"

const BASE = process.argv[2] ?? "http://localhost:3000"
const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

const failures = []
const check = (label, ok, detail) => {
  console.log(`${ok ? "  ok  " : "FAIL  "} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures.push(label)
}

const admin = (path, init = {}) =>
  fetch(`${URL_BASE}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  })

const form = (obj) =>
  fetch(`${BASE}/api/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(obj),
  })

const REDIRECT = "https://claude.ai/api/mcp/auth_callback"
let clientId = null

try {
  console.log("== descoberta ==")
  const meta = await fetch(`${BASE}/.well-known/oauth-authorization-server`)
  const metaBody = meta.ok ? await meta.json() : {}
  check("metadata do autorizador responde", meta.ok, `HTTP ${meta.status}`)
  check(
    "só S256 é anunciado",
    JSON.stringify(metaBody.code_challenge_methods_supported) === '["S256"]',
    JSON.stringify(metaBody.code_challenge_methods_supported)
  )

  const res = await fetch(`${BASE}/.well-known/oauth-protected-resource`)
  check("metadata do recurso responde", res.ok, `HTTP ${res.status}`)

  console.log("\n== registro ==")
  const reg = await fetch(`${BASE}/api/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "__probe-oauth", redirect_uris: [REDIRECT] }),
  })
  const regBody = reg.ok ? await reg.json() : {}
  clientId = regBody.client_id
  check("registro dinâmico devolve client_id", Boolean(clientId), `HTTP ${reg.status}`)

  const bad = await fetch(`${BASE}/api/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "x", redirect_uris: ["http://evil.example/cb"] }),
  })
  check("registro recusa redirect http externo", bad.status === 400, `HTTP ${bad.status}`)

  // Emite um code direto no banco: a tela de consentimento exige navegador.
  const [{ id: userId }] = await (
    await admin("/rest/v1/workspace_members?select=user_id&limit=1")
  )
    .json()
    .then((rows) => rows.map((r) => ({ id: r.user_id })))
  const [{ workspace_id: workspaceId }] = await (
    await admin(`/rest/v1/workspace_members?select=workspace_id&user_id=eq.${userId}&limit=1`)
  ).json()

  async function mintCode(challenge) {
    const code = randomBytes(32).toString("base64url")
    const hash = createHash("sha256").update(code).digest("hex")
    const r = await admin("/rest/v1/mcp_oauth_codes", {
      method: "POST",
      body: JSON.stringify({
        code_hash: hash,
        client_id: clientId,
        user_id: userId,
        workspace_id: workspaceId,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    })
    if (!r.ok) throw new Error(`mintCode: ${await r.text()}`)
    return code
  }

  console.log("\n== PKCE ==")
  const verifier = randomBytes(32).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")

  const wrongPkce = await form({
    grant_type: "authorization_code",
    code: await mintCode(challenge),
    code_verifier: "verifier-errado",
    client_id: clientId,
    redirect_uri: REDIRECT,
  })
  check("code_verifier errado é recusado", wrongPkce.status === 400, `HTTP ${wrongPkce.status}`)

  const wrongRedirect = await form({
    grant_type: "authorization_code",
    code: await mintCode(challenge),
    code_verifier: verifier,
    client_id: clientId,
    redirect_uri: "https://claude.ai/outro",
  })
  check("redirect_uri divergente é recusado", wrongRedirect.status === 400, `HTTP ${wrongRedirect.status}`)

  console.log("\n== caminho feliz e reuso ==")
  const code = await mintCode(challenge)
  const okRes = await form({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    client_id: clientId,
    redirect_uri: REDIRECT,
  })
  const tokens = okRes.ok ? await okRes.json() : {}
  check("troca code por token", Boolean(tokens.access_token), `HTTP ${okRes.status}`)
  check("devolve refresh token", Boolean(tokens.refresh_token))
  check("expires_in é 3600", tokens.expires_in === 3600, String(tokens.expires_in))

  const replay = await form({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    client_id: clientId,
    redirect_uri: REDIRECT,
  })
  check("code reusado é recusado", replay.status === 400, `HTTP ${replay.status}`)

  console.log("\n== o token abre o MCP ==")
  const mcp = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${tokens.access_token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  })
  const mcpBody = mcp.ok ? await mcp.json() : {}
  check("tools/list responde com as 14 tools", mcpBody?.result?.tools?.length === 14, `HTTP ${mcp.status}`)

  console.log("\n== rotação e revogação ==")
  const refreshed = await form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token })
  const newPair = refreshed.ok ? await refreshed.json() : {}
  check("refresh devolve par novo", Boolean(newPair.access_token), `HTTP ${refreshed.status}`)
  check("refresh token roda", newPair.refresh_token !== tokens.refresh_token)

  const reused = await form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token })
  check("refresh antigo não vale mais", reused.status === 400, `HTTP ${reused.status}`)

  const oldToken = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${tokens.access_token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  })
  check("access antigo morre com a rotação", oldToken.status === 401, `HTTP ${oldToken.status}`)

  await fetch(`${BASE}/api/oauth/revoke`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: newPair.access_token }),
  })
  const afterRevoke = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${newPair.access_token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  })
  check("token revogado é recusado", afterRevoke.status === 401, `HTTP ${afterRevoke.status}`)
} finally {
  if (clientId) {
    await admin(`/rest/v1/mcp_oauth_tokens?client_id=eq.${clientId}`, { method: "DELETE" })
    await admin(`/rest/v1/mcp_oauth_codes?client_id=eq.${clientId}`, { method: "DELETE" })
    await admin(`/rest/v1/mcp_oauth_clients?client_id=eq.${clientId}`, { method: "DELETE" })
    console.log("\ncliente de teste removido")
  }
}

if (failures.length) {
  console.error(`\n${failures.length} falha(s):\n  ${failures.join("\n  ")}`)
  process.exit(1)
}
console.log("\nFluxo OAuth conforme.")
```

- [ ] **Step 2: Registrar o script**

Em `package.json`, dentro de `scripts`:

```json
"verify:oauth": "node --env-file=.env.local scripts/verify-oauth-flow.mjs"
```

- [ ] **Step 3: Rodar contra o local**

Com `npm run dev` de pé:

Run: `npm run verify:oauth -- http://localhost:3000`
Expected: `Fluxo OAuth conforme.` Qualquer FAIL é bloqueante.

- [ ] **Step 4: Preparar as env vars de produção**

Na Vercel → Settings → Environment Variables, confirmar que `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` existem em Production.

**`MCP_DEV_TOKEN` e `MCP_DEV_USER_ID` NÃO vão para produção.** Sem eles, o atalho de desenvolvimento não existe lá — só OAuth.

- [ ] **Step 5: Deploy e verificação em produção**

```bash
npx vercel --prod
npm run verify:oauth -- https://crmflash.vercel.app
```

Expected: `Fluxo OAuth conforme.`

- [ ] **Step 6: Conectar o claude.ai**

Em claude.ai → Settings → Connectors → Add custom connector, informe:

```
https://crmflash.vercel.app/api/mcp
```

Expected: ele descobre o autorizador pelo metadata, registra-se sozinho, abre a tela de consentimento do CRMFlash, e depois de autorizar as 14 tools aparecem. Teste no celular perguntando *"o que está parado no meu pipeline?"*.

- [ ] **Step 7: Commit**

```bash
git add scripts/verify-oauth-flow.mjs package.json
git commit -m "test(oauth): conformidade do fluxo ponta a ponta"
```

---

## Estado ao fim da Fatia 2

- O claude.ai (web e celular) conecta no `/api/mcp` por OAuth 2.1 com PKCE.
- Tokens guardados só como hash; refresh rotativo; revogação de dentro do app.
- O atalho de desenvolvimento continua funcionando no Claude Code local, e não existe em produção.
- As 14 tools nunca souberam que a autenticação mudou.
