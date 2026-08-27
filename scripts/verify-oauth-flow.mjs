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
//
// Uso: npm run verify:oauth -- http://localhost:3003
import { createHash, randomBytes } from "node:crypto"

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "")
const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!URL_BASE || !SERVICE) throw new Error("Faltam variáveis do Supabase em .env.local")

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

const tokenReq = (obj) =>
  fetch(`${BASE}/api/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(obj),
  })

const mcpReq = (accessToken) =>
  fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
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
  if (!clientId) throw new Error("sem client_id — o resto do fluxo não tem como rodar")

  const bad = await fetch(`${BASE}/api/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "x", redirect_uris: ["http://evil.example/cb"] }),
  })
  check("registro recusa redirect http externo", bad.status === 400, `HTTP ${bad.status}`)

  console.log("\n== CSRF na aprovação ==")
  const csrf = await fetch(`${BASE}/api/oauth/approve`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      Origin: "https://evil.example",
    },
    body: new URLSearchParams({ client_id: clientId }),
  })
  check("approve recusa origem estranha", csrf.status === 403, `HTTP ${csrf.status}`)

  // Emite o code direto no banco: a tela de consentimento exige navegador.
  const members = await (
    await admin("/rest/v1/workspace_members?select=user_id,workspace_id&limit=1")
  ).json()
  if (!members.length) throw new Error("nenhum workspace_member — o banco está vazio?")
  const { user_id: userId, workspace_id: workspaceId } = members[0]

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

  const wrongPkce = await tokenReq({
    grant_type: "authorization_code",
    code: await mintCode(challenge),
    code_verifier: "verifier-errado",
    client_id: clientId,
    redirect_uri: REDIRECT,
  })
  check("code_verifier errado é recusado", wrongPkce.status === 400, `HTTP ${wrongPkce.status}`)

  const wrongRedirect = await tokenReq({
    grant_type: "authorization_code",
    code: await mintCode(challenge),
    code_verifier: verifier,
    client_id: clientId,
    redirect_uri: "https://claude.ai/outro",
  })
  check(
    "redirect_uri divergente é recusado",
    wrongRedirect.status === 400,
    `HTTP ${wrongRedirect.status}`
  )

  const wrongClient = await tokenReq({
    grant_type: "authorization_code",
    code: await mintCode(challenge),
    code_verifier: verifier,
    client_id: "outro-cliente",
    redirect_uri: REDIRECT,
  })
  check("code de outro cliente é recusado", wrongClient.status === 400, `HTTP ${wrongClient.status}`)

  console.log("\n== caminho feliz e reuso ==")
  const code = await mintCode(challenge)
  const okRes = await tokenReq({
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

  const replay = await tokenReq({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    client_id: clientId,
    redirect_uri: REDIRECT,
  })
  check("code reusado é recusado", replay.status === 400, `HTTP ${replay.status}`)

  console.log("\n== o token abre o MCP ==")
  const mcp = await mcpReq(tokens.access_token)
  const mcpBody = mcp.ok ? await mcp.json() : {}
  check(
    "tools/list responde com as 14 tools",
    mcpBody?.result?.tools?.length === 14,
    `HTTP ${mcp.status}`
  )

  // last_used_at só é escrito porque o lookup é um UPDATE. A versão anterior
  // montava o update e descartava o builder, então nunca mandava a requisição —
  // e a coluna "último uso" da tela de conexões ficava eternamente vazia.
  const used = await (
    await admin(
      `/rest/v1/mcp_oauth_tokens?select=last_used_at&client_id=eq.${clientId}&order=created_at.desc&limit=1`
    )
  ).json()
  check("o uso do token é registrado", Boolean(used[0]?.last_used_at), used[0]?.last_used_at ?? "null")

  console.log("\n== token expirado ==")
  const expired = randomBytes(32).toString("base64url")
  await admin("/rest/v1/mcp_oauth_tokens", {
    method: "POST",
    body: JSON.stringify({
      client_id: clientId,
      user_id: userId,
      workspace_id: workspaceId,
      access_token_hash: createHash("sha256").update(expired).digest("hex"),
      expires_at: new Date(Date.now() - 1000).toISOString(),
    }),
  })
  const expiredRes = await mcpReq(expired)
  check("token expirado é recusado", expiredRes.status === 401, `HTTP ${expiredRes.status}`)

  console.log("\n== rotação e revogação ==")
  const refreshed = await tokenReq({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
  })
  const newPair = refreshed.ok ? await refreshed.json() : {}
  check("refresh devolve par novo", Boolean(newPair.access_token), `HTTP ${refreshed.status}`)
  check("refresh token roda", newPair.refresh_token !== tokens.refresh_token)

  const reused = await tokenReq({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
  })
  check("refresh antigo não vale mais", reused.status === 400, `HTTP ${reused.status}`)

  const oldToken = await mcpReq(tokens.access_token)
  check("access antigo morre com a rotação", oldToken.status === 401, `HTTP ${oldToken.status}`)

  await fetch(`${BASE}/api/oauth/revoke`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: newPair.access_token }),
  })
  const afterRevoke = await mcpReq(newPair.access_token)
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
