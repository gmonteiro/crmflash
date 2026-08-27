export interface PersonIdentityFields {
  first_name?: string | null
  last_name?: string | null
  current_title?: string | null
  current_company?: string | null
}

// A chave que decide se duas linhas são a mesma pessoa. Estava escrita inline em
// três pontos de use-import.ts; o MCP precisa da MESMA regra, e três cópias
// viram quatro definições divergentes na primeira vez que alguém mexer.
export function personDedupKey(p: PersonIdentityFields): string {
  return [p.first_name, p.last_name, p.current_title, p.current_company]
    .map((s) => (s ?? "").toLowerCase().trim())
    .join("|")
}

export function companyDedupKey(name: string): string {
  return name.toLowerCase().trim()
}
