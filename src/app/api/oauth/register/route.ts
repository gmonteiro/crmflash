import { NextRequest, NextResponse } from "next/server"
import { registerClient } from "@/lib/oauth/store"
import { rateLimit, rateLimitKey } from "@/lib/rate-limit"

export interface RegistrationResult {
  ok: boolean
  error?: string
  client_name?: string
  redirect_uris?: string[]
}

/**
 * RFC 7591. Registro é aberto por necessidade — o claude.ai precisa se
 * cadastrar sozinho — mas o que ele registra é validado: um redirect_uri é
 * para onde um authorization code será entregue, e aceitar qualquer coisa aqui
 * transformaria o endpoint num redirecionador de codes.
 */
export function validateRegistration(body: unknown): RegistrationResult {
  const b = body as { client_name?: unknown; redirect_uris?: unknown }

  const name = typeof b?.client_name === "string" ? b.client_name.trim() : ""
  if (!name) return { ok: false, error: "client_name é obrigatório" }

  if (!Array.isArray(b?.redirect_uris) || b.redirect_uris.length === 0) {
    return { ok: false, error: "redirect_uris é obrigatório" }
  }

  const uris: string[] = []
  for (const raw of b.redirect_uris) {
    if (typeof raw !== "string") return { ok: false, error: "redirect_uri inválido" }

    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return { ok: false, error: `redirect_uri inválido: ${raw}` }
    }

    // Fragmento é proibido pela RFC 6749 §3.1.2 — e é por onde se esconde
    // destino alternativo num URI que parece legítimo.
    if (url.hash) return { ok: false, error: "redirect_uri não pode ter fragmento" }

    const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1"
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost)) {
      return { ok: false, error: "redirect_uri precisa ser https (ou http em localhost)" }
    }

    uris.push(raw)
  }

  return { ok: true, client_name: name, redirect_uris: uris }
}

export async function POST(request: NextRequest) {
  const rl = rateLimit(rateLimitKey(request, "oauth-register"), {
    limit: 10,
    windowMs: 60_000,
  })
  if (!rl.success) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_client_metadata" }, { status: 400 })
  }

  const parsed = validateRegistration(body)
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "invalid_client_metadata", error_description: parsed.error },
      { status: 400 }
    )
  }

  const { client_id } = await registerClient(parsed.client_name!, parsed.redirect_uris!)

  return NextResponse.json(
    {
      client_id,
      client_name: parsed.client_name,
      redirect_uris: parsed.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { status: 201 }
  )
}
