import type { CopilotProvider } from "./types"

// Só existe o provider Anthropic por enquanto. Mantém a forma de factory do
// enrich (require lazy) para que um segundo provider entre sem tocar nas rotas.
export function getCopilotProvider(): CopilotProvider {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AnthropicCopilotProvider } = require("./providers/anthropic") as typeof import("./providers/anthropic")
  return new AnthropicCopilotProvider()
}

export function hasCopilotApiKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

export type { CopilotProvider, CopilotCompanyContext } from "./types"
