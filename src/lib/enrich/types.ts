export interface PersonHints {
  full_name: string
  email?: string | null
  current_title?: string | null
  current_company?: string | null
  linkedin_url?: string | null
}

export interface PersonEnrichResult {
  current_title?: string
  current_company?: string
  linkedin_url?: string
  avatar_url?: string
  notes?: string
}

export interface CompanyHints {
  name: string
  domain?: string | null
  website?: string | null
  people?: {
    name: string
    title?: string | null
    email?: string | null
    linkedin_url?: string | null
    current_company?: string | null
  }[]
}

export interface CompanyEnrichResult {
  industry?: string
  description?: string
  website?: string
  domain?: string
  linkedin_url?: string
  employee_count?: number
  estimated_revenue?: number
  size_tier?: string
}

export interface StreamCallbacks {
  onReasoning?: (chunk: string) => void
  onProgress?: () => void
}

export interface EnrichProvider {
  enrichPerson(hints: PersonHints, callbacks?: StreamCallbacks): Promise<PersonEnrichResult>
  enrichCompany(hints: CompanyHints, callbacks?: StreamCallbacks): Promise<CompanyEnrichResult>
  enrichCompaniesBatch(
    companies: { hints: CompanyHints; id: string }[],
    callbacks?: StreamCallbacks & { onBatchItem?: (id: string, result: CompanyEnrichResult) => void },
  ): Promise<Map<string, CompanyEnrichResult>>
}

export type EnrichSSEEvent =
  | { type: "reasoning"; text: string }
  | { type: "result"; success: boolean; enriched: PersonEnrichResult | CompanyEnrichResult }
  | { type: "batch_item"; id: string; success: boolean; enriched: CompanyEnrichResult }
  | { type: "done"; succeeded: number; failed: number }
  | { type: "error"; message: string }
