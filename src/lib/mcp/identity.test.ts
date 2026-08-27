import { describe, it, expect, beforeAll } from "vitest"
import { extractBearer, resolveWorkspaceId, matchesDevToken } from "./identity"
import { fakeSupabase } from "./fake-supabase"

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

describe("resolveWorkspaceId", () => {
  it("filtra por user_id — sem isso, workspace com 2 membros derruba o login", async () => {
    const { client, calls } = fakeSupabase({
      workspace_members: [{ workspace_id: "ws-1" }],
    })

    const ws = await resolveWorkspaceId(client, "user-1")

    expect(ws).toBe("ws-1")
    const query = calls.find((c) => c.table === "workspace_members")
    expect(query!.filters).toEqual({ user_id: "user-1" })
  })

  it("devolve null quando o usuário não é membro de nada", async () => {
    const { client } = fakeSupabase({ workspace_members: [] })
    expect(await resolveWorkspaceId(client, "user-1")).toBeNull()
  })
})

describe("matchesDevToken", () => {
  it("não vale nada quando MCP_DEV_TOKEN não está configurado", () => {
    delete process.env.MCP_DEV_TOKEN
    expect(matchesDevToken("qualquer-coisa")).toBe(false)
  })

  it("compara com o valor configurado", () => {
    process.env.MCP_DEV_TOKEN = "token-de-dev"
    expect(matchesDevToken("token-de-dev")).toBe(true)
    expect(matchesDevToken("outro")).toBe(false)
  })

  it("recusa token de tamanho diferente sem estourar", () => {
    process.env.MCP_DEV_TOKEN = "token-de-dev"
    expect(matchesDevToken("x")).toBe(false)
  })
})
