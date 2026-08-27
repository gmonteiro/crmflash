import { describe, it, expect } from "vitest"
import { validateRegistration } from "@/app/api/oauth/register/route"

describe("validateRegistration", () => {
  it("aceita um registro bem formado", () => {
    const out = validateRegistration({
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
    })
    expect(out.ok).toBe(true)
  })

  it("recusa sem redirect_uris", () => {
    expect(validateRegistration({ client_name: "Claude" }).ok).toBe(false)
  })

  it("recusa sem client_name", () => {
    expect(
      validateRegistration({ redirect_uris: ["https://claude.ai/cb"] }).ok
    ).toBe(false)
  })

  it("recusa redirect_uri que não é https", () => {
    const out = validateRegistration({
      client_name: "Claude",
      redirect_uris: ["http://evil.example/cb"],
    })
    expect(out.ok).toBe(false)
  })

  it("aceita http em localhost — é o caso de desenvolvimento", () => {
    const out = validateRegistration({
      client_name: "Claude",
      redirect_uris: ["http://localhost:5173/cb"],
    })
    expect(out.ok).toBe(true)
  })

  it("recusa redirect_uri com fragmento", () => {
    const out = validateRegistration({
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/cb#x"],
    })
    expect(out.ok).toBe(false)
  })

  it("recusa lista vazia", () => {
    expect(
      validateRegistration({ client_name: "Claude", redirect_uris: [] }).ok
    ).toBe(false)
  })
})
