import { NextRequest, NextResponse } from "next/server"
import { resolveIdentity, type McpIdentity } from "@/lib/mcp/identity"
import { findTool, toolListPayload } from "@/lib/mcp/registry"
import { rateLimit } from "@/lib/rate-limit"

export const maxDuration = 60

const PROTOCOL_VERSION = "2025-06-18"

interface JsonRpcRequest {
  jsonrpc: "2.0"
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

function result(id: JsonRpcRequest["id"], value: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id, result: value })
}

function failure(id: JsonRpcRequest["id"], code: number, message: string) {
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } })
}

export async function POST(request: NextRequest) {
  let body: JsonRpcRequest
  try {
    body = await request.json()
  } catch {
    return failure(null, -32700, "Parse error")
  }

  const { id = null, method, params = {} } = body

  const identity = await resolveIdentity(request)
  if (!identity) {
    // 401 com WWW-Authenticate é o que faz o cliente MCP iniciar o fluxo de
    // auth na Fatia 2. Sem ele, o cliente só mostra "erro" e desiste.
    return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": `Bearer resource_metadata="${new URL("/.well-known/oauth-protected-resource", request.url)}"`,
      },
    })
  }

  const rl = rateLimit(`mcp:${identity.userId}`, { limit: 120, windowMs: 60_000 })
  if (!rl.success) return failure(id, -32000, "Too many requests")

  switch (method) {
    case "initialize":
      return result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "crmflash", version: "1.0.0" },
      })

    // Notificação: sem id, sem resposta.
    case "notifications/initialized":
      return new NextResponse(null, { status: 202 })

    case "tools/list":
      return result(id, { tools: toolListPayload() })

    case "tools/call": {
      const name = params.name as string
      const tool = findTool(name)
      if (!tool) return failure(id, -32602, `Tool desconhecida: ${name}`)

      const parsed = tool.input.safeParse(params.arguments ?? {})
      if (!parsed.success) {
        return result(id, {
          isError: true,
          content: [{ type: "text", text: `Argumentos inválidos: ${parsed.error.message}` }],
        })
      }

      // Único cast do arquivo: o registry apaga o genérico para o array ser
      // heterogêneo, e aqui o zod já validou que os args batem com o schema.
      const handler = tool.handler as (
        identity: McpIdentity,
        args: unknown
      ) => Promise<unknown>

      try {
        const value = await handler(identity, parsed.data)
        return result(id, {
          content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
        })
      } catch (err) {
        // Erro de tool volta como isError no resultado, não como erro JSON-RPC:
        // é assim que o modelo consegue ler a mensagem e tentar outra coisa.
        return result(id, {
          isError: true,
          content: [
            { type: "text", text: err instanceof Error ? err.message : "Erro desconhecido" },
          ],
        })
      }
    }

    default:
      return failure(id, -32601, `Método não suportado: ${method}`)
  }
}
