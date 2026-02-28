import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic()

interface PersonHints {
  full_name: string
  email?: string | null
  current_title?: string | null
  current_company?: string | null
  linkedin_url?: string | null
}

interface PersonEnrichResult {
  current_title?: string
  current_company?: string
  linkedin_url?: string
  avatar_url?: string
  notes?: string
}

interface CompanyHints {
  name: string
  domain?: string | null
  website?: string | null
  people?: { name: string; title?: string | null; email?: string | null; linkedin_url?: string | null; current_company?: string | null }[]
}

interface CompanyEnrichResult {
  industry?: string
  description?: string
  website?: string
  domain?: string
  linkedin_url?: string
  employee_count?: number
  estimated_revenue?: number
  size_tier?: string
}

function stripCiteTags(text: string): string {
  return text.replace(/<\/?cite[^>]*>/g, "")
}

function extractJson<T>(text: string): T | null {
  const clean = stripCiteTags(text)
  // Try to find JSON in code blocks first
  const codeBlockMatch = clean.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim())
    } catch { /* fall through */ }
  }
  // Try to find JSON object directly
  const jsonMatch = clean.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0])
    } catch { /* fall through */ }
  }
  return null
}

function getTextFromResponse(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
}

export async function enrichPersonWithAI(hints: PersonHints): Promise<PersonEnrichResult> {
  const parts = [hints.full_name]
  if (hints.current_company) parts.push(hints.current_company)
  if (hints.current_title) parts.push(hints.current_title)
  if (hints.email) parts.push(hints.email)

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    tools: [
      { type: "web_search_20250305" as const, name: "web_search" },
    ],
    messages: [
      {
        role: "user",
        content: `Search the web for professional information about this person: ${parts.join(", ")}.

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
}`,
      },
    ],
  })

  const text = getTextFromResponse(response)
  return extractJson<PersonEnrichResult>(text) ?? {}
}

export async function enrichCompanyWithAI(hints: CompanyHints): Promise<CompanyEnrichResult> {
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

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    tools: [
      { type: "web_search_20250305" as const, name: "web_search" },
    ],
    messages: [
      {
        role: "user",
        content: `Search the web for information about this company: ${parts.join(", ")}.${peopleContext}

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
}`,
      },
    ],
  })

  const text = getTextFromResponse(response)
  return extractJson<CompanyEnrichResult>(text) ?? {}
}
