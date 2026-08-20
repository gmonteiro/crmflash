// Dump completo das tabelas via PostgREST com service role.
// Rede de segurança antes da migration 010 — este projeto não tem staging.
// Rode com: node --env-file=.env.local scripts/backup-tables.mjs
import { mkdirSync, writeFileSync } from "node:fs"

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) throw new Error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")

const TABLES = [
  "companies", "people", "kanban_columns", "tags", "shortlists", "activities",
  "import_history", "company_documents", "company_activities", "company_next_steps",
  "company_commitment_signals", "company_stage_events", "copilot_question_events",
  "people_tags", "shortlist_members",
]

const PAGE = 1000

async function dump(table) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${URL}/rest/v1/${table}?select=*`, {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        Range: `${from}-${from + PAGE - 1}`,
      },
    })
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`)
    const batch = await res.json()
    rows.push(...batch)
    if (batch.length < PAGE) break
  }
  return rows
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-")
const dir = `backup/${stamp}`
mkdirSync(dir, { recursive: true })

for (const table of TABLES) {
  const rows = await dump(table)
  writeFileSync(`${dir}/${table}.json`, JSON.stringify(rows, null, 2))
  console.log(`${table}: ${rows.length} linhas`)
}
console.log(`\nBackup em ${dir}`)
