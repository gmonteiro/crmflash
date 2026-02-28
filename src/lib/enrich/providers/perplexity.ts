import OpenAI from "openai"
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

const MODEL = "sonar"

function getClient() {
  return new OpenAI({
    apiKey: process.env.PERPLEXITY_API_KEY,
    baseURL: "https://api.perplexity.ai",
  })
}

async function streamChat(
  messages: OpenAI.ChatCompletionMessageParam[],
  callbacks?: StreamCallbacks,
): Promise<string> {
  const client = getClient()
  const stream = await client.chat.completions.create({
    model: MODEL,
    messages,
    max_tokens: 2048,
    stream: true,
  })

  let text = ""
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content
    if (delta) {
      text += delta
      callbacks?.onReasoning?.(delta)
      callbacks?.onProgress?.()
    }
  }
  return text
}

export class PerplexityEnrichProvider implements EnrichProvider {
  async enrichPerson(
    hints: PersonHints,
    callbacks?: StreamCallbacks,
  ): Promise<PersonEnrichResult> {
    const prompt = buildPersonPrompt(hints)
    const text = await streamChat(
      [{ role: "user", content: prompt }],
      callbacks,
    )
    return extractJson<PersonEnrichResult>(text) ?? {}
  }

  async enrichCompany(
    hints: CompanyHints,
    callbacks?: StreamCallbacks,
  ): Promise<CompanyEnrichResult> {
    const prompt = buildCompanyPrompt(hints)
    const text = await streamChat(
      [{ role: "user", content: prompt }],
      callbacks,
    )
    return extractJson<CompanyEnrichResult>(text) ?? {}
  }

  async enrichCompaniesBatch(
    companies: { hints: CompanyHints; id: string }[],
    callbacks?: StreamCallbacks & { onBatchItem?: (id: string, result: CompanyEnrichResult) => void },
  ): Promise<Map<string, CompanyEnrichResult>> {
    // Perplexity uses web search per request — process sequentially
    const results = new Map<string, CompanyEnrichResult>()
    for (const company of companies) {
      const result = await this.enrichCompany(company.hints, callbacks)
      results.set(company.id, result)
      callbacks?.onBatchItem?.(company.id, result)
    }
    return results
  }
}
