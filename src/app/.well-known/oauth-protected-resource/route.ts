import { NextRequest, NextResponse } from "next/server"

// RFC 9728. É o que o cliente MCP busca depois de tomar 401 do /api/mcp: o
// header WWW-Authenticate aponta para cá, e daqui ele descobre quem autoriza.
export async function GET(request: NextRequest) {
  const origin = new URL(request.url).origin

  return NextResponse.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
  })
}
