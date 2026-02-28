import OpenAI from "openai"
import type {
  EnrichProvider,
  PersonHints,
  PersonEnrichResult,
  CompanyHints,
  CompanyEnrichResult,
  StreamCallbacks,
} from "../types"
import { extractJson, extractJsonArray } from "../parse"
import { buildPersonPrompt, buildCompanyPrompt, buildBatchCompanyPrompt } from "../prompts"

const MODEL = "gpt-4o-mini"

function getClient() {
  return new OpenAI()
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

export class OpenAIEnrichProvider implements EnrichProvider {
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
    const results = new Map<string, CompanyEnrichResult>()
    const prompt = buildBatchCompanyPrompt(companies)
    const text = await streamChat(
      [{ role: "user", content: prompt }],
      callbacks,
    )

    const parsed = extractJsonArray<CompanyEnrichResult & { id: string }>(text)
    if (parsed) {
      for (const item of parsed) {
        const { id, ...enrichResult } = item
        if (id) {
          results.set(id, enrichResult)
          callbacks?.onBatchItem?.(id, enrichResult)
        }
      }
    }

    return results
  }
}
