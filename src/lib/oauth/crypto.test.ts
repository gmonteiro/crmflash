import { describe, it, expect } from "vitest"
import { createHash, randomBytes } from "crypto"
import { randomToken, hashToken, verifyPkce } from "./crypto"

describe("randomToken", () => {
  it("gera valores diferentes a cada chamada", () => {
    const seen = new Set(Array.from({ length: 100 }, () => randomToken()))
    expect(seen.size).toBe(100)
  })

  it("é base64url — seguro em URL e header", () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe("hashToken", () => {
  it("é sha256 hex do valor", () => {
    const expected = createHash("sha256").update("abc").digest("hex")
    expect(hashToken("abc")).toBe(expected)
  })

  it("é determinístico e distingue valores próximos", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"))
    expect(hashToken("abc")).not.toBe(hashToken("abd"))
  })
})

describe("verifyPkce", () => {
  it("aceita o par correto", () => {
    const verifier = randomBytes(32).toString("base64url")
    const challenge = createHash("sha256").update(verifier).digest("base64url")
    expect(verifyPkce(verifier, challenge)).toBe(true)
  })

  it("recusa verifier errado", () => {
    const challenge = createHash("sha256").update("certo").digest("base64url")
    expect(verifyPkce("errado", challenge)).toBe(false)
  })

  it("recusa challenge vazio", () => {
    expect(verifyPkce("qualquer", "")).toBe(false)
  })
})
