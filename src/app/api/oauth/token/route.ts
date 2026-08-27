import { NextRequest, NextResponse } from "next/server"
import { consumeCode, issueTokens, rotateRefresh } from "@/lib/oauth/store"
import { verifyPkce } from "@/lib/oauth/crypto"
import { rateLimit, rateLimitKey } from "@/lib/rate-limit"

function oauthError(error: string, description: string, status = 400) {
  return NextResponse.json({ error, error_description: description }, { status })
}

export async function POST(request: NextRequest) {
  const rl = rateLimit(rateLimitKey(request, "oauth-token"), { limit: 30, windowMs: 60_000 })
  if (!rl.success) return oauthError("temporarily_unavailable", "muitas tentativas", 429)

  const form = await request.formData()
  const grant = String(form.get("grant_type") ?? "")

  if (grant === "refresh_token") {
    const refresh = String(form.get("refresh_token") ?? "")
    const pair = await rotateRefresh(refresh)
    if (!pair) return oauthError("invalid_grant", "refresh token inválido ou expirado")

    return NextResponse.json({
      access_token: pair.accessToken,
      refresh_token: pair.refreshToken,
      token_type: "Bearer",
      expires_in: pair.expiresIn,
    })
  }

  if (grant !== "authorization_code") {
    return oauthError("unsupported_grant_type", `grant_type não suportado: ${grant}`)
  }

  const code = String(form.get("code") ?? "")
  const verifier = String(form.get("code_verifier") ?? "")
  const clientId = String(form.get("client_id") ?? "")
  const redirectUri = String(form.get("redirect_uri") ?? "")

  const record = await consumeCode(code)
  if (!record) return oauthError("invalid_grant", "code inválido, expirado ou já usado")

  // As três amarrações que fazem o code valer só para quem o pediu.
  if (record.client_id !== clientId) {
    return oauthError("invalid_grant", "code não pertence a este cliente")
  }
  if (record.redirect_uri !== redirectUri) {
    return oauthError("invalid_grant", "redirect_uri diferente do usado na autorização")
  }
  if (!verifyPkce(verifier, record.code_challenge)) {
    return oauthError("invalid_grant", "code_verifier não confere")
  }

  const pair = await issueTokens({
    clientId: record.client_id,
    userId: record.user_id,
    workspaceId: record.workspace_id,
  })

  return NextResponse.json({
    access_token: pair.accessToken,
    refresh_token: pair.refreshToken,
    token_type: "Bearer",
    expires_in: pair.expiresIn,
  })
}
