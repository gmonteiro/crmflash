import Anthropic from "@anthropic-ai/sdk"
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

const MODEL = "claude-haiku-4-5"

function getClient() {
  return new Anthropic()
}

async function streamMessage(
  prompt: string,
  callbacks?: StreamCallbacks,
): Promise<string> {
  const client = getClient()
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 1024,
    tools: [
      { type: "web_search_20250305" as const, name: "web_search" },
    ],
    messages: [{ role: "user", content: prompt }],
  })

  stream.on("text", (delta) => {
    callbacks?.onReasoning?.(delta)
    callbacks?.onProgress?.()
  })

  const response = await stream.finalMessage()
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
}

export class AnthropicEnrichProvider implements EnrichProvider {
  async enrichPerson(
    hints: PersonHints,
    callbacks?: StreamCallbacks,
  ): Promise<PersonEnrichResult> {
    const prompt = buildPersonPrompt(hints)
    const text = await streamMessage(prompt, callbacks)
    return extractJson<PersonEnrichResult>(text) ?? {}
  }

  async enrichCompany(
    hints: CompanyHints,
    callbacks?: StreamCallbacks,
  ): Promise<CompanyEnrichResult> {
    const prompt = buildCompanyPrompt(hints)
    const text = await streamMessage(prompt, callbacks)
    return extractJson<CompanyEnrichResult>(text) ?? {}
  }

  async enrichCompaniesBatch(
    companies: { hints: CompanyHints; id: string }[],
    callbacks?: StreamCallbacks & { onBatchItem?: (id: string, result: CompanyEnrichResult) => void },
  ): Promise<Map<string, CompanyEnrichResult>> {
    // Anthropic with web_search doesn't batch well — process sequentially
    const results = new Map<string, CompanyEnrichResult>()
    for (const company of companies) {
      const result = await this.enrichCompany(company.hints, callbacks)
      results.set(company.id, result)
      callbacks?.onBatchItem?.(company.id, result)
    }
    return results
  }
}
