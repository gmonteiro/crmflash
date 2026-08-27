import { describe, it, expect } from "vitest"
import { buildCodeRow, buildTokenRows, isUsable } from "./store"
import { hashToken } from "./crypto"

const NOW = new Date("2026-08-27T12:00:00Z")

const CODE_PARAMS = {
  clientId: "cli-1",
  userId: "user-1",
  workspaceId: "ws-1",
  redirectUri: "https://claude.ai/cb",
  codeChallenge: "challenge",
}

const TOKEN_PARAMS = { clientId: "cli-1", userId: "user-1", workspaceId: "ws-1" }

describe("buildCodeRow", () => {
  it("guarda o hash do code, nunca o code", () => {
    const { code, row } = buildCodeRow(CODE_PARAMS, NOW)

    expect(row.code_hash).toBe(hashToken(code))
    expect(JSON.stringify(row)).not.toContain(code)
  })

  it("expira em 60 segundos", () => {
    const { row } = buildCodeRow(CODE_PARAMS, NOW)

    expect(new Date(row.expires_at).getTime() - NOW.getTime()).toBe(60_000)
  })
})

describe("buildTokenRows", () => {
  it("guarda os dois hashes e nenhum valor em claro", () => {
    const { accessToken, refreshToken, row } = buildTokenRows(TOKEN_PARAMS, NOW)

    expect(row.access_token_hash).toBe(hashToken(accessToken))
    expect(row.refresh_token_hash).toBe(hashToken(refreshToken))
    expect(JSON.stringify(row)).not.toContain(accessToken)
    expect(JSON.stringify(row)).not.toContain(refreshToken)
  })

  it("access vale 1h e refresh vale 30 dias", () => {
    const { row } = buildTokenRows(TOKEN_PARAMS, NOW)

    expect(new Date(row.expires_at).getTime() - NOW.getTime()).toBe(3600_000)
    expect(new Date(row.refresh_expires_at).getTime() - NOW.getTime()).toBe(
      30 * 24 * 3600_000
    )
  })

  it("access e refresh são valores distintos", () => {
    const { accessToken, refreshToken } = buildTokenRows(TOKEN_PARAMS, NOW)
    expect(accessToken).not.toBe(refreshToken)
  })
})

describe("isUsable", () => {
  const future = new Date(NOW.getTime() + 1000).toISOString()
  const past = new Date(NOW.getTime() - 1000).toISOString()

  it("aceita token vivo e não revogado", () => {
    expect(isUsable({ expires_at: future, revoked_at: null }, NOW)).toBe(true)
  })

  it("recusa token expirado", () => {
    expect(isUsable({ expires_at: past, revoked_at: null }, NOW)).toBe(false)
  })

  it("recusa token revogado, mesmo dentro da validade", () => {
    expect(isUsable({ expires_at: future, revoked_at: past }, NOW)).toBe(false)
  })
})
