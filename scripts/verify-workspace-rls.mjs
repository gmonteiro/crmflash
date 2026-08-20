// Cria dois usuários descartáveis — um DENTRO do workspace existente, um FORA —
// e afirma, para cada tabela, que o de dentro lê e o de fora não lê nada.
//
// O risco real da migração de workspaces é RLS, e vitest não alcança RLS:
// este script é o teste que importa.
//
// Rode com: node --env-file=.env.local scripts/verify-workspace-rls.mjs
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!URL || !SERVICE || !ANON) throw new Error("Faltam variáveis do Supabase em .env.local")

const TABLES = [
  "companies", "people", "kanban_columns", "tags", "shortlists", "activities",
  "import_history", "company_documents", "company_activities", "company_next_steps",
  "company_commitment_signals", "company_stage_events", "copilot_question_events",
  "people_tags", "shortlist_members",
]

const admin = (path, init = {}) =>
  fetch(`${URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  })

const asUser = (token, path) =>
  fetch(`${URL}${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } })

async function createUser(email) {
  const password = `Test-${Math.random().toString(36).slice(2)}-Aa1!`
  const res = await admin("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  if (!res.ok) throw new Error(`createUser ${email}: ${await res.text()}`)
  const user = await res.json()

  const login = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  if (!login.ok) throw new Error(`login ${email}: ${await login.text()}`)
  const { access_token } = await login.json()
  return { id: user.id, token: access_token }
}

const deleteUser = (id) => admin(`/auth/v1/admin/users/${id}`, { method: "DELETE" })

async function count(token, table) {
  const res = await asUser(token, `/rest/v1/${table}?select=*&limit=1000`)
  if (!res.ok) return { error: `HTTP ${res.status}` }
  return { rows: (await res.json()).length }
}

const failures = []
const check = (label, ok, detail) => {
  console.log(`${ok ? "  ok  " : "FAIL  "} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures.push(label)
}

// --- setup -------------------------------------------------------------------
const suffix = Math.random().toString(36).slice(2, 8)
const insider = await createUser(`rls-in-${suffix}@example.com`)
const outsider = await createUser(`rls-out-${suffix}@example.com`)

try {
  // O workspace com os dados reais é o mais antigo.
  const wsRes = await admin("/rest/v1/workspaces?select=id&order=created_at.asc&limit=1")
  if (!wsRes.ok) throw new Error(`Nenhum workspace encontrado — a migration 010 rodou? (HTTP ${wsRes.status})`)
  const [ws] = await wsRes.json()
  if (!ws) throw new Error("Nenhum workspace encontrado — a migration 010 rodou?")

  // O insider entra nesse workspace. O outsider fica sem workspace nenhum.
  const join = await admin("/rest/v1/workspace_members", {
    method: "POST",
    body: JSON.stringify({ workspace_id: ws.id, user_id: insider.id }),
  })
  if (!join.ok) throw new Error(`join: ${await join.text()}`)

  console.log("\n== insider (membro do workspace) deve LER ==")
  for (const table of TABLES) {
    const { rows, error } = await count(insider.token, table)
    check(`insider lê ${table}`, error === undefined, error ?? `${rows} linhas`)
  }

  console.log("\n== outsider (sem workspace) NÃO deve ler nada ==")
  for (const table of TABLES) {
    const { rows, error } = await count(outsider.token, table)
    check(
      `outsider bloqueado em ${table}`,
      error !== undefined || rows === 0,
      error ?? `${rows} linhas VAZARAM`
    )
  }

  console.log("\n== outsider não deve conseguir escrever ==")
  const write = await fetch(`${URL}/rest/v1/companies`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${outsider.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "empresa-invasora" }),
  })
  check("outsider bloqueado ao inserir company", !write.ok, `HTTP ${write.status}`)

  console.log("\n== guarda do último membro ==")
  const delSelf = await fetch(`${URL}/rest/v1/workspace_members?user_id=eq.${insider.id}`, {
    method: "DELETE",
    headers: { apikey: ANON, Authorization: `Bearer ${insider.token}` },
  })
  check("insider consegue sair (não é o último)", delSelf.ok, `HTTP ${delSelf.status}`)
} finally {
  await deleteUser(insider.id)
  await deleteUser(outsider.id)
  console.log("\nusuários de teste removidos")
}

if (failures.length) {
  console.error(`\n${failures.length} falha(s):\n  ${failures.join("\n  ")}`)
  process.exit(1)
}
console.log("\nTudo isolado.")
