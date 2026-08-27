import { describe, it, expect } from "vitest"
import { validateAuthorizeParams } from "@/app/api/oauth/approve/route"
import type { McpOAuthClient } from "@/types/database"

const CLIENT: McpOAuthClient = {
  client_id: "cli-1",
  client_name: "Claude",
  redirect_uris: ["https://claude.ai/cb"],
  created_at: "2026-08-27T00:00:00Z",
}

function params(over: Record<string, string> = {}) {
  return new URLSearchParams({
    client_id: "cli-1",
    redirect_uri: "https://claude.ai/cb",
    response_type: "code",
    code_challenge: "abc",
    code_challenge_method: "S256",
    state: "xyz",
    ...over,
  })
}

describe("validateAuthorizeParams", () => {
  it("aceita um pedido bem formado", () => {
    expect(validateAuthorizeParams(params(), CLIENT).ok).toBe(true)
  })

  it("recusa cliente desconhecido", () => {
    expect(validateAuthorizeParams(params(), null).ok).toBe(false)
  })

  it("recusa redirect_uri que não foi registrado", () => {
    const out = validateAuthorizeParams(
      params({ redirect_uri: "https://claude.ai/outro" }),
      CLIENT
    )
    expect(out.ok).toBe(false)
  })

  it("compara redirect_uri por igualdade, não por prefixo", () => {
    // Sem igualdade exata, este passaria por "https://claude.ai/cb" e o code
    // iria para outro host.
    const out = validateAuthorizeParams(
      params({ redirect_uri: "https://claude.ai/cb.evil.example" }),
      CLIENT
    )
    expect(out.ok).toBe(false)
  })

  it("recusa PKCE plain — é OAuth 2.1", () => {
    const out = validateAuthorizeParams(
      params({ code_challenge_method: "plain" }),
      CLIENT
    )
    expect(out.ok).toBe(false)
  })

  it("recusa pedido sem code_challenge", () => {
    const p = params()
    p.delete("code_challenge")
    expect(validateAuthorizeParams(p, CLIENT).ok).toBe(false)
  })

  it("recusa response_type diferente de code", () => {
    expect(validateAuthorizeParams(params({ response_type: "token" }), CLIENT).ok).toBe(
      false
    )
  })

  it("devolve o state para o cliente conferir", () => {
    expect(validateAuthorizeParams(params(), CLIENT).state).toBe("xyz")
  })
})
