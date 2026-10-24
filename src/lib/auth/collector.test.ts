import { describe, it, expect, afterEach } from "vitest"
import { createHash } from "crypto"
import { isCollectorAuthorized } from "./collector"

const req = (h?: string) => new Request("https://x/api", { headers: h ? { authorization: h } : {} })
afterEach(() => {
  delete process.env.WHATSAPP_COLLECTOR_TOKEN_SHA256
})

describe("token do coletor", () => {
  it("sem hash configurado, nada passa", () => {
    expect(isCollectorAuthorized(req("Bearer abc"))).toBe(false)
  })
  it("compara o hash do token, não o token", () => {
    process.env.WHATSAPP_COLLECTOR_TOKEN_SHA256 = createHash("sha256").update("segredo").digest("hex")
    expect(isCollectorAuthorized(req("Bearer segredo"))).toBe(true)
    expect(isCollectorAuthorized(req("Bearer outro"))).toBe(false)
    expect(isCollectorAuthorized(req())).toBe(false)
  })
})
