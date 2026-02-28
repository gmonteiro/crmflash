import Exa from "exa-js"
import type {
  EnrichProvider,
  PersonHints,
  PersonEnrichResult,
  CompanyHints,
  CompanyEnrichResult,
  StreamCallbacks,
} from "../types"
import { extractJson } from "../parse"
import { buildPersonPrompt, buildCompanyPrompt } from "../prompts"

function getClient() {
  return new Exa(process.env.EXA_API_KEY)
}

async function askExa(
  query: string,
  callbacks?: StreamCallbacks,
): Promise<string> {
  const client = getClient()
  const response = await client.answer(query, {})
  const text = String(response.answer)
  callbacks?.onReasoning?.(text)
  callbacks?.onProgress?.()
  return text
}

export class ExaEnrichProvider implements EnrichProvider {
  async enrichPerson(
    hints: PersonHints,
    callbacks?: StreamCallbacks,
  ): Promise<PersonEnrichResult> {
    const prompt = buildPersonPrompt(hints)
    const text = await askExa(prompt, callbacks)
    return extractJson<PersonEnrichResult>(text) ?? {}
  }

  async enrichCompany(
    hints: CompanyHints,
    callbacks?: StreamCallbacks,
  ): Promise<CompanyEnrichResult> {
    const prompt = buildCompanyPrompt(hints)
    const text = await askExa(prompt, callbacks)
    return extractJson<CompanyEnrichResult>(text) ?? {}
  }

  async enrichCompaniesBatch(
    companies: { hints: CompanyHints; id: string }[],
    callbacks?: StreamCallbacks & { onBatchItem?: (id: string, result: CompanyEnrichResult) => void },
  ): Promise<Map<string, CompanyEnrichResult>> {
    // Exa answers one at a time — process sequentially
    const results = new Map<string, CompanyEnrichResult>()
    for (const company of companies) {
      const result = await this.enrichCompany(company.hints, callbacks)
      results.set(company.id, result)
      callbacks?.onBatchItem?.(company.id, result)
    }
    return results
  }
}
