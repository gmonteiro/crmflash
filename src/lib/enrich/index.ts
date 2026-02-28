import type { EnrichProvider } from "./types"

export function getEnrichProvider(override?: string): EnrichProvider {
  const provider = override || process.env.ENRICH_PROVIDER || "openai"

  if (provider === "anthropic") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AnthropicEnrichProvider } = require("./providers/anthropic") as typeof import("./providers/anthropic")
    return new AnthropicEnrichProvider()
  }

  if (provider === "perplexity") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PerplexityEnrichProvider } = require("./providers/perplexity") as typeof import("./providers/perplexity")
    return new PerplexityEnrichProvider()
  }

  if (provider === "exa") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ExaEnrichProvider } = require("./providers/exa") as typeof import("./providers/exa")
    return new ExaEnrichProvider()
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
