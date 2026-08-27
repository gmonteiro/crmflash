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
  if (!clientId) return null

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
  if (!code) return null

  const supabase = adminClient()
  const hash = hashToken(code)

  const { data } = await supabase
    .from("mcp_oauth_codes")
    .select(
      "client_id, user_id, workspace_id, redirect_uri, code_challenge, expires_at, consumed_at"
    )
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
  if (!refreshToken) return null

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

/**
 * Valida o token e marca o uso numa tacada só.
 *
 * É um UPDATE com a validade no WHERE, não um SELECT seguido de UPDATE. Dois
 * motivos. Uma ida ao banco em vez de duas, no caminho quente de toda
 * requisição do MCP. E porque a versão anterior — `void supabase...update()` —
 * simplesmente não escrevia: o builder do supabase-js só dispara a requisição
 * quando alguém chama .then(), então descartá-lo monta a query e não manda
 * nada. Em serverless o fire-and-forget também não serviria, porque a
 * instância congela assim que a resposta sai.
 *
 * Token expirado ou revogado não casa com o WHERE, então não volta linha e
 * também não tem o uso registrado.
 */
export async function lookupAccessToken(
  accessToken: string
): Promise<{ userId: string; workspaceId: string } | null> {
  if (!accessToken) return null

  const now = new Date().toISOString()

  const { data } = await adminClient()
    .from("mcp_oauth_tokens")
    .update({ last_used_at: now })
    .eq("access_token_hash", hashToken(accessToken))
    .is("revoked_at", null)
    .gt("expires_at", now)
    .select("user_id, workspace_id")
    .maybeSingle()

  if (!data) return null

  return { userId: data.user_id, workspaceId: data.workspace_id }
}

/** RFC 7009: revoga por access OU refresh, e não diz qual dos dois era. */
export async function revokeToken(token: string): Promise<void> {
  if (!token) return

  const supabase = adminClient()
  const hash = hashToken(token)
  const now = new Date().toISOString()

  await supabase
    .from("mcp_oauth_tokens")
    .update({ revoked_at: now })
    .eq("access_token_hash", hash)
  await supabase
    .from("mcp_oauth_tokens")
    .update({ revoked_at: now })
    .eq("refresh_token_hash", hash)
}
