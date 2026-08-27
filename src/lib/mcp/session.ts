/**
 * Cunha e renova sessões Supabase reais para o servidor MCP.
 *
 * Por que não assinar o JWT nós mesmos: o projeto migrou para chaves
 * assimétricas (ECC P-256) e a Supabase não exporta a parte privada. O segredo
 * HS256 antigo ainda verifica tokens, mas está em "Previously used keys" com
 * instrução de revogar — construir em cima dele seria construir sobre uma chave
 * com data de demolição.
 *
 * Cunhando pelo admin API, o token sai assinado pela chave CORRENTE, e
 * auth.uid() / current_workspace() funcionam nativamente: a RLS escopa toda
 * tool sem que nenhuma precise lembrar de filtrar.
 */

export interface UserSession {
  accessToken: string
  refreshToken: string
  /** Epoch em ms. */
  expiresAt: number
}

export type FetchImpl = typeof globalThis.fetch

/** Renova com folga: um token que expira durante a requisição não serve. */
const REFRESH_MARGIN_MS = 60_000

// Cache de processo, como o rate-limit.ts: suficiente para instância quente da
// Vercel. Cunhar por requisição encheria auth.sessions de linhas descartáveis.
const cache = new Map<string, UserSession>()

export function isFresh(session: UserSession, now = Date.now()): boolean {
  return session.expiresAt - REFRESH_MARGIN_MS > now
}

/** Só para teste — o cache é global de propósito. */
export function clearSessionCache(): void {
  cache.clear()
}

function requireEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !service || !anon) {
    throw new Error(
      "Faltam NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ou NEXT_PUBLIC_SUPABASE_ANON_KEY"
    )
  }
  return { url, service, anon }
}

function toSession(body: {
  access_token?: string
  refresh_token?: string
  expires_in?: number
}): UserSession | null {
  if (!body.access_token || !body.refresh_token) return null
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  }
}

async function lookupEmail(userId: string, fetchImpl: FetchImpl): Promise<string> {
  const { url, service } = requireEnv()
  const res = await fetchImpl(`${url}/auth/v1/admin/users/${userId}`, {
    headers: { apikey: service, Authorization: `Bearer ${service}` },
  })
  if (!res.ok) throw new Error(`Usuário ${userId} não encontrado (HTTP ${res.status})`)

  const user = (await res.json()) as { email?: string }
  if (!user.email) throw new Error(`Usuário ${userId} não tem e-mail — não dá para cunhar sessão`)
  return user.email
}

/**
 * Cunha uma sessão nova: gera um magiclink pelo admin e troca o hashed_token
 * por access + refresh. A sessão é independente da do navegador, então o
 * rodízio do refresh token aqui não derruba o app aberto.
 */
export async function mintSession(
  userId: string,
  fetchImpl: FetchImpl = globalThis.fetch
): Promise<UserSession> {
  const { url, service, anon } = requireEnv()
  const email = await lookupEmail(userId, fetchImpl)

  const link = await fetchImpl(`${url}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email }),
  })
  if (!link.ok) throw new Error(`generate_link falhou (HTTP ${link.status})`)

  const props = (await link.json()) as {
    hashed_token?: string
    properties?: { hashed_token?: string }
  }
  const hashed = props.hashed_token ?? props.properties?.hashed_token
  if (!hashed) throw new Error("generate_link não devolveu hashed_token")

  const verify = await fetchImpl(`${url}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token_hash: hashed }),
  })
  if (!verify.ok) throw new Error(`verify falhou (HTTP ${verify.status})`)

  const session = toSession(await verify.json())
  if (!session) throw new Error("verify não devolveu access_token e refresh_token")
  return session
}

export async function refreshSession(
  refreshToken: string,
  fetchImpl: FetchImpl = globalThis.fetch
): Promise<UserSession | null> {
  const { url, anon } = requireEnv()

  const res = await fetchImpl(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
  if (!res.ok) return null

  return toSession(await res.json())
}

/**
 * O access token do usuário, do cache quando dá. Renova por refresh token antes
 * de cunhar do zero: renovar é uma chamada, cunhar são três e cria linha nova
 * em auth.sessions.
 */
export async function getAccessToken(
  userId: string,
  fetchImpl: FetchImpl = globalThis.fetch
): Promise<string> {
  const cached = cache.get(userId)
  if (cached && isFresh(cached)) return cached.accessToken

  if (cached) {
    const renewed = await refreshSession(cached.refreshToken, fetchImpl)
    if (renewed) {
      cache.set(userId, renewed)
      return renewed.accessToken
    }
    // Refresh token revogado ou expirado: cai para cunhar do zero.
    cache.delete(userId)
  }

  const fresh = await mintSession(userId, fetchImpl)
  cache.set(userId, fresh)
  return fresh.accessToken
}
