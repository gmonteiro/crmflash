import { NextRequest, NextResponse } from "next/server"
import { revokeToken } from "@/lib/oauth/store"

// RFC 7009. Responde 200 mesmo para token que não existe: dizer "esse token eu
// não conheço" transformaria o endpoint num oráculo de tokens válidos.
export async function POST(request: NextRequest) {
  const form = await request.formData()
  const token = String(form.get("token") ?? "")

  if (token) await revokeToken(token)

  return new NextResponse(null, { status: 200 })
}
