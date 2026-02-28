import type { PersonHints, CompanyHints } from "./types"

export function buildPersonPrompt(hints: PersonHints): string {
  const parts = [hints.full_name]
  if (hints.current_company) parts.push(hints.current_company)
  if (hints.current_title) parts.push(hints.current_title)
  if (hints.email) parts.push(hints.email)

  return `Search for professional information about this person: ${parts.join(", ")}.

Find their:
- Current job title
- Current company name
- LinkedIn profile URL
- A brief professional summary (1-2 sentences)

Return ONLY a JSON object with these fields (omit fields you can't find):
{
  "current_title": "...",
  "current_company": "...",
  "linkedin_url": "...",
  "notes": "..."
}`
}

export function buildCompanyPrompt(hints: CompanyHints): string {
  const parts = [hints.name]
  if (hints.domain) parts.push(hints.domain)
  if (hints.website) parts.push(hints.website)

  let peopleContext = ""
  if (hints.people && hints.people.length > 0) {
    const lines = hints.people.map((p) => {
      const details = [p.name]
      if (p.title) details.push(`title: ${p.title}`)
      if (p.current_company) details.push(`listed employer: ${p.current_company}`)
      if (p.email) details.push(`email: ${p.email}`)
      if (p.linkedin_url) details.push(`linkedin: ${p.linkedin_url}`)
      return `- ${details.join(", ")}`
    })
    peopleContext = `\n\nIMPORTANT — Known employees at this company. Use their names, nationalities, email domains, LinkedIn profiles, and listed employers to identify the EXACT correct company. For example, Brazilian employee names indicate a Brazilian company:\n${lines.join("\n")}`
  }

  return `Search for information about this company: ${parts.join(", ")}.${peopleContext}

Find:
- Industry
- Brief description (1-2 sentences)
- Website URL
- LinkedIn company page URL
- Approximate employee count (number)
- Approximate annual revenue in USD (number, no currency symbols)
- Size tier: one of "Micro", "Small", "Medium", "Large", "Enterprise"

Return ONLY a JSON object with these fields (omit fields you can't find):
{
  "industry": "...",
  "description": "...",
  "website": "...",
  "domain": "...",
  "linkedin_url": "...",
  "employee_count": 0,
  "estimated_revenue": 0,
  "size_tier": "..."
}`
}

export function buildBatchCompanyPrompt(
  companies: { id: string; hints: CompanyHints }[],
): string {
  const companyDescriptions = companies.map((c, i) => {
    const parts = [c.hints.name]
    if (c.hints.domain) parts.push(c.hints.domain)
    if (c.hints.website) parts.push(c.hints.website)

    let peopleContext = ""
    if (c.hints.people && c.hints.people.length > 0) {
      const lines = c.hints.people.map((p) => {
        const details = [p.name]
        if (p.title) details.push(`title: ${p.title}`)
        if (p.email) details.push(`email: ${p.email}`)
        return `  - ${details.join(", ")}`
      })
      peopleContext = `\n  Known employees:\n${lines.join("\n")}`
    }

    return `${i + 1}. "${c.hints.name}" (id: ${c.id}) — ${parts.join(", ")}${peopleContext}`
  })

  return `Research the following ${companies.length} companies and return information about each.

Companies:
${companyDescriptions.join("\n\n")}

For each company, find: industry, brief description (1-2 sentences), website URL, domain, LinkedIn company page URL, approximate employee count, approximate annual revenue in USD, and size tier (Micro/Small/Medium/Large/Enterprise).

Return ONLY a JSON array with one object per company, in the same order. Each object must include an "id" field matching the company id above:
[
  {
    "id": "...",
    "industry": "...",
    "description": "...",
    "website": "...",
    "domain": "...",
    "linkedin_url": "...",
    "employee_count": 0,
    "estimated_revenue": 0,
    "size_tier": "..."
  }
]`
}
