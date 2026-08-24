// Verifica a migration 013 (donos de contato) contra o banco real.
//
// O que pode dar errado aqui não é lógica de aplicação, é schema: o trigger que
// não dispara, a view que devolve os donos de outro workspace, o par duplicado
// que estoura no segundo import. Nada disso vitest alcança.
//
// Rode com: node --env-file=.env.local scripts/verify-contact-owners.mjs
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!URL || !SERVICE || !ANON) throw new Error("Faltam variáveis do Supabase em .env.local")

const admin = (path, init = {}) =>
  fetch(`${URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      Prefer: init.method === "POST" ? "return=representation" : "",
      ...init.headers,
    },
  })

const asUser = (token, path, init = {}) =>
  fetch(`${URL}${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  })

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

const failures = []
const check = (label, ok, detail) => {
  console.log(`${ok ? "  ok  " : "FAIL  "} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures.push(label)
}

// --- setup -------------------------------------------------------------------
const suffix = Math.random().toString(36).slice(2, 8)
const alice = await createUser(`own-a-${suffix}@example.com`)
const bob = await createUser(`own-b-${suffix}@example.com`)
const outsider = await createUser(`own-out-${suffix}@example.com`)

const cleanup = []

try {
  const wsRes = await admin("/rest/v1/workspaces?select=id&order=created_at.asc&limit=1")
  const [ws] = wsRes.ok ? await wsRes.json() : []
  if (!ws) throw new Error("Nenhum workspace encontrado — a migration 010 rodou?")

  for (const u of [alice, bob]) {
    const join = await admin("/rest/v1/workspace_members", {
      method: "POST",
      body: JSON.stringify({ workspace_id: ws.id, user_id: u.id }),
    })
    if (!join.ok) throw new Error(`join: ${await join.text()}`)
  }

  // --- 1. trigger --------------------------------------------------------------
  console.log("\n== o trigger grava o dono no insert ==")
  // O `user_id` explicito nao e decoracao: people.user_id nao tem DEFAULT, e o
  // trigger so grava dono quando ele vem preenchido. Todo caminho do app manda
  // (use-people, use-import, /api/enrich, company-select), entao o teste manda
  // tambem — omitir aqui testaria um app que nao existe.
  const create = await asUser(alice.token, "/rest/v1/people", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: alice.id,
      first_name: "__owner-probe",
      last_name: suffix,
      current_company: `__probe-co-${suffix}`,
    }),
  })
  const [person] = create.ok ? await create.json() : []
  check("alice cria contato", create.ok, `HTTP ${create.status}`)
  if (!person) throw new Error("sem contato para testar — o resto do script depende dele")
  cleanup.push(() => admin(`/rest/v1/people?id=eq.${person.id}`, { method: "DELETE" }))

  const ownersOf = async (token, personId) => {
    const res = await asUser(token, `/rest/v1/people_owners?select=user_id&person_id=eq.${personId}`)
    return res.ok ? (await res.json()).map((r) => r.user_id) : { error: `HTTP ${res.status}` }
  }

  const afterInsert = await ownersOf(alice.token, person.id)
  check(
    "alice já é dona do contato que criou",
    Array.isArray(afterInsert) && afterInsert.includes(alice.id),
    JSON.stringify(afterInsert)
  )

  // --- 2. co-propriedade -------------------------------------------------------
  // É o caminho que o import percorre quando o dedup pula uma linha.
  console.log("\n== o segundo import vira co-propriedade, não erro ==")
  const coOwn = (token) =>
    asUser(token, "/rest/v1/people_owners", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify({ person_id: person.id, user_id: bob.id }),
    })

  const first = await coOwn(bob.token)
  check("bob vira co-dono", first.ok, `HTTP ${first.status}`)

  // Subir a mesma planilha duas vezes não pode explodir.
  const second = await coOwn(bob.token)
  check("inserir o mesmo par de novo é inofensivo", second.ok, `HTTP ${second.status}`)

  const both = await ownersOf(alice.token, person.id)
  check(
    "o contato aparece com DOIS donos",
    Array.isArray(both) && both.includes(alice.id) && both.includes(bob.id),
    Array.isArray(both) ? `${both.length} dono(s)` : JSON.stringify(both)
  )

  // --- 3. a view ---------------------------------------------------------------
  console.log("\n== company_owners deriva dos contatos ==")
  const companyRes = await asUser(alice.token, "/rest/v1/companies", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ user_id: alice.id, name: `__owner-probe-co-${suffix}` }),
  })
  const [company] = companyRes.ok ? await companyRes.json() : []
  check("alice cria empresa", companyRes.ok, `HTTP ${companyRes.status}`)
  if (company) {
    cleanup.push(() => admin(`/rest/v1/companies?id=eq.${company.id}`, { method: "DELETE" }))

    const viewOwners = async (token) => {
      const res = await asUser(
        token,
        `/rest/v1/company_owners?select=user_id&company_id=eq.${company.id}`
      )
      return res.ok ? (await res.json()).map((r) => r.user_id) : { error: `HTTP ${res.status}` }
    }

    // Sem contato nenhum: só o criador, pelo segundo braço do union.
    const creatorOnly = await viewOwners(alice.token)
    check(
      "empresa sem contato mostra quem a criou",
      Array.isArray(creatorOnly) && creatorOnly.length === 1 && creatorOnly[0] === alice.id,
      JSON.stringify(creatorOnly)
    )

    // Ligando o contato de dois donos: a empresa passa a mostrar os dois.
    const link = await asUser(alice.token, `/rest/v1/people?id=eq.${person.id}`, {
      method: "PATCH",
      body: JSON.stringify({ company_id: company.id }),
    })
    check("contato ligado à empresa", link.ok, `HTTP ${link.status}`)

    const derived = await viewOwners(alice.token)
    check(
      "empresa herda os dois donos do contato",
      Array.isArray(derived) && derived.includes(alice.id) && derived.includes(bob.id),
      Array.isArray(derived) ? `${derived.length} dono(s)` : JSON.stringify(derived)
    )

    // A relacao computada da 014: e ela que faz o filtro por dono da listagem
    // de empresas alcancar tambem as empresas sem contato nenhum.
    const filtered = await asUser(
      alice.token,
      `/rest/v1/companies?select=id,owners!inner(user_id)&owners.user_id=eq.${alice.id}&id=eq.${company.id}`
    )
    const filteredRows = filtered.ok ? await filtered.json() : []
    check(
      "filtro companies?owners!inner alcanca a empresa (migration 014)",
      filtered.ok && filteredRows.length === 1,
      filtered.ok ? `${filteredRows.length} linha(s)` : `HTTP ${filtered.status}`
    )

    console.log("\n== outsider não enxerga nada disso ==")
    const leakedView = await viewOwners(outsider.token)
    check(
      "company_owners não vaza",
      !Array.isArray(leakedView) || leakedView.length === 0,
      Array.isArray(leakedView) ? `${leakedView.length} linha(s)` : JSON.stringify(leakedView)
    )
  }

  const leaked = await ownersOf(outsider.token, person.id)
  check(
    "people_owners não vaza",
    !Array.isArray(leaked) || leaked.length === 0,
    Array.isArray(leaked) ? `${leaked.length} linha(s)` : JSON.stringify(leaked)
  )

  const intruso = await asUser(outsider.token, "/rest/v1/people_owners", {
    method: "POST",
    body: JSON.stringify({ person_id: person.id, user_id: outsider.id }),
  })
  check("outsider bloqueado ao se declarar dono", !intruso.ok, `HTTP ${intruso.status}`)
} finally {
  for (const undo of cleanup.reverse()) await undo()
  await Promise.all([deleteUser(alice.id), deleteUser(bob.id), deleteUser(outsider.id)])
  console.log("\nusuários e linhas de teste removidos")
}

if (failures.length) {
  console.error(`\n${failures.length} falha(s):\n  ${failures.join("\n  ")}`)
  process.exit(1)
}
console.log("\nDonos de contato de pé.")
