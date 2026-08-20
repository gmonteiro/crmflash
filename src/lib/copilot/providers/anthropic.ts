import Anthropic from "@anthropic-ai/sdk"
import { extractJson } from "@/lib/enrich/parse"
import { buildInterpretPrompt } from "../prompts"
import type { CopilotCompanyContext, CopilotProvider } from "../types"

const MODEL = "claude-haiku-4-5"

// temperature 0: extração de fatos, não redação criativa. Sem tools — todo o
// contexto necessário já vai no prompt.
async function complete(prompt: string): Promise<string> {
  const client = new Anthropic()
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
  })

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
}

export class AnthropicCopilotProvider implements CopilotProvider {
  async interpret(
    ctx: CopilotCompanyContext,
    question: string,
    narration: string
  ): Promise<unknown> {
    const text = await complete(buildInterpretPrompt(ctx, question, narration))
    return extractJson<unknown>(text)
  }
}
