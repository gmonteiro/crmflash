import type { EnrichProvider } from "./types"

export function getEnrichProvider(): EnrichProvider {
  const provider = process.env.ENRICH_PROVIDER || "openai"

  if (provider === "anthropic") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AnthropicEnrichProvider } = require("./providers/anthropic") as typeof import("./providers/anthropic")
    return new AnthropicEnrichProvider()
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { OpenAIEnrichProvider } = require("./providers/openai") as typeof import("./providers/openai")
  return new OpenAIEnrichProvider()
}

export type { EnrichProvider } from "./types"
export type {
  PersonHints,
  PersonEnrichResult,
  CompanyHints,
  CompanyEnrichResult,
  StreamCallbacks,
  EnrichSSEEvent,
} from "./types"
