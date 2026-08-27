// Verifica que o JWT assinado pelo servidor MCP se comporta, para a RLS,
// exatamente como um token emitido pelo Supabase Auth: lê o próprio workspace e
// não enxerga nem escreve no alheio.
//
// O que está sendo testado é a RLS do Postgres, e vitest não alcança RLS — este
// script é o teste que importa para o MCP, como verify-workspace-rls.mjs é para
// os workspaces.
//
// Rode com: node --env-file=.env.local scripts/verify-mcp-rls.mjs
import { SignJWT } from "jose"

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET

if (!URL_BASE || !SERVICE || !ANON) throw new Error("Faltam variáveis do Supabase em .env.local")
if (!JWT_SECRET)
  throw new Error(
    "SUPABASE_JWT_SECRET não configurado — Dashboard > Project Settings > API > JWT Settings"
  )

const TABLES = [
  "companies",
  "people",
  "company_activities",
  "company_next_steps",
  "company_commitment_signals",
  "company_stage_events",
  "copilot_question_events",
  "kanban_columns",
]

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

// A MESMA assinatura de src/lib/mcp/jwt.ts. Duplicada de propósito: scripts/ não
// tem build de TS, e o ponto do teste é justamente provar que este formato de
// token funciona — importar a implementação esconderia um erro de formato.
async function mcpToken(userId) {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setAudience("authenticated")
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(new TextEncoder().encode(JWT_SECRET))
}

const asUser = (token, path, init = {}) =>
  fetch(`${URL_BASE}${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  })

async function countRows(token, table) {
  const res = await asUser(token, `/rest/v1/${table}?select=*&limit=1000`)
  if (!res.ok) return { error: `HTTP ${res.status}` }
  return { rows: (await res.json()).length }
}

async function createUser(email) {
  const password = `Test-${Math.random().toString(36).slice(2)}-Aa1!`
  const res = await admin("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  if (!res.ok) throw new Error(`createUser ${email}: ${await res.text()}`)
  return (await res.json()).id
}

const deleteUser = (id) => admin(`/auth/v1/admin/users/${id}`, { method: "DELETE" })

const failures = []
const check = (label, ok, detail) => {
  console.log(`${ok ? "  ok  " : "FAIL  "} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures.push(label)
}

// --- setup -------------------------------------------------------------------
const suffix = Math.random().toString(36).slice(2, 8)
const insiderId = await createUser(`mcp-in-${suffix}@example.com`)
const outsiderId = await createUser(`mcp-out-${suffix}@example.com`)
let strangeWsId = null

try {
  // O workspace com os dados reais é o mais antigo.
  const wsRes = await admin("/rest/v1/workspaces?select=id&order=created_at.asc&limit=1")
  const [realWs] = wsRes.ok ? await wsRes.json() : []
  if (!realWs) throw new Error("Nenhum workspace encontrado — a migration 010 rodou?")

  const join = await admin("/rest/v1/workspace_members", {
    method: "POST",
    body: JSON.stringify({ workspace_id: realWs.id, user_id: insiderId }),
  })
  if (!join.ok) throw new Error(`join insider: ${await join.text()}`)

  // O outsider ganha um workspace SÓ DELE. Sem workspace nenhum o teste seria
  // fraco: resolveIdentity recusaria o token antes de chegar na RLS.
  const wsCreate = await admin("/rest/v1/workspaces", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ name: `__mcp-probe-${suffix}`, created_by: outsiderId }),
  })
  if (!wsCreate.ok) throw new Error(`criar workspace do outsider: ${await wsCreate.text()}`)
  strangeWsId = (await wsCreate.json())[0].id

  const joinOut = await admin("/rest/v1/workspace_members", {
    method: "POST",
    body: JSON.stringify({ workspace_id: strangeWsId, user_id: outsiderId }),
  })
  if (!joinOut.ok) throw new Error(`join outsider: ${await joinOut.text()}`)

  const insiderToken = await mcpToken(insiderId)
  const outsiderToken = await mcpToken(outsiderId)

  // --- controle positivo -----------------------------------------------------
  // Sem isto o teste inteiro é vazio: um JWT com assinatura errada também lê
  // zero linhas, e "não vazou nada" passaria com o token completamente quebrado.
  console.log("\n== controle: o JWT do MCP precisa FUNCIONAR ==")
  let insiderSawSomething = false
  for (const table of TABLES) {
    const { rows, error } = await countRows(insiderToken, table)
    if (!error && rows > 0) insiderSawSomething = true
    check(`insider lê ${table}`, error === undefined, error ?? `${rows} linhas`)
  }
  check(
    "JWT assinado por nós é aceito pela RLS (leu dados reais)",
    insiderSawSomething,
    insiderSawSomething ? undefined : "leu 0 linhas em TODAS as tabelas — token inválido?"
  )

  // --- isolamento ------------------------------------------------------------
  console.log("\n== leitura cruzada: outsider não vê o workspace alheio ==")
  for (const table of TABLES) {
    const res = await asUser(
      outsiderToken,
      `/rest/v1/${table}?select=id&workspace_id=eq.${realWs.id}&limit=1`
    )
    const rows = res.ok ? (await res.json()).length : 0
    check(
      `outsider bloqueado em ${table}`,
      rows === 0,
      res.ok ? (rows === 0 ? "0 linhas" : `${rows} linha(s) VAZARAM`) : `HTTP ${res.status}`
    )
  }

  console.log("\n== escrita cruzada: outsider não escreve no workspace alheio ==")
  const write = await asUser(outsiderToken, "/rest/v1/company_activities", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: realWs.id,
      company_id: "00000000-0000-4000-8000-000000000000",
      type: "note",
      title: `__mcp-probe-${suffix}: esta linha não deveria existir`,
    }),
  })
  check("outsider bloqueado ao inserir em workspace alheio", !write.ok, `HTTP ${write.status}`)

  console.log("\n== token expirado deve ser recusado ==")
  const expired = await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(insiderId)
    .setAudience("authenticated")
    .setIssuedAt(Math.floor(Date.now() / 1000) - 600)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 300)
    .sign(new TextEncoder().encode(JWT_SECRET))
  const expiredRes = await asUser(expired, "/rest/v1/companies?select=id&limit=1")
  check("JWT expirado recusado", !expiredRes.ok, `HTTP ${expiredRes.status}`)
} finally {
  if (strangeWsId) {
    await admin(`/rest/v1/workspace_members?workspace_id=eq.${strangeWsId}`, { method: "DELETE" })
    await admin(`/rest/v1/workspaces?id=eq.${strangeWsId}`, { method: "DELETE" })
  }
  await deleteUser(insiderId)
  await deleteUser(outsiderId)
  console.log("\nusuários e workspace de teste removidos")
}

if (failures.length) {
  console.error(`\n${failures.length} falha(s):\n  ${failures.join("\n  ")}`)
  process.exit(1)
}
console.log("\nTudo isolado.")
