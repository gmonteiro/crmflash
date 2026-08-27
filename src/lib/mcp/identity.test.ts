import { describe, it, expect, beforeAll } from "vitest"
import { extractBearer } from "./identity"

beforeAll(() => {
  process.env.MCP_DEV_TOKEN = "token-de-dev"
})

function req(headers: Record<string, string>) {
  return new Request("https://x.test/api/mcp", { headers })
}

describe("extractBearer", () => {
  it("devolve o token de um header bem formado", () => {
    expect(extractBearer(req({ authorization: "Bearer abc123" }))).toBe("abc123")
  })

  it("devolve null sem header", () => {
    expect(extractBearer(req({}))).toBeNull()
  })

  it("devolve null para esquema que não é Bearer", () => {
    expect(extractBearer(req({ authorization: "Basic abc123" }))).toBeNull()
  })

  it("devolve null para Bearer sem valor", () => {
    expect(extractBearer(req({ authorization: "Bearer" }))).toBeNull()
  })
})
