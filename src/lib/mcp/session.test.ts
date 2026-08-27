import { describe, it, expect, beforeEach } from "vitest"
import {
  isFresh,
  mintSession,
  refreshSession,
  getAccessToken,
  clearSessionCache,
  type FetchImpl,
} from "./session"

const USER = "9fb7f9f3-abbb-4284-a98d-ef8188abc5f5"

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co"
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key"
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key"
  clearSessionCache()
})

/** fetch falso roteado por trecho da URL, contando as chamadas. */
function fakeFetch(routes: Record<string, { status?: number; body?: unknown }>) {
  const calls: string[] = []
  const impl = (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    const key = Object.keys(routes).find((k) => url.includes(k))
    const route = key ? routes[key] : undefined
    const status = route?.status ?? (route ? 200 : 404)
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => route?.body ?? {},
    } as Response
  }) as unknown as FetchImpl
  return { impl, calls }
}

const HAPPY = {
  "/auth/v1/admin/users/": { body: { email: "ana@example.com" } },
  "/auth/v1/admin/generate_link": { body: { properties: { hashed_token: "hash-1" } } },
  "/auth/v1/verify": {
    body: { access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600 },
  },
}

describe("isFresh", () => {
  it("considera velho um token que expira dentro da margem", () => {
    const now = 1_000_000
    expect(isFresh({ accessToken: "a", refreshToken: "r", expiresAt: now + 30_000 }, now)).toBe(
      false
    )
    expect(isFresh({ accessToken: "a", refreshToken: "r", expiresAt: now + 600_000 }, now)).toBe(
      true
    )
  })
})

describe("mintSession", () => {
  it("busca o e-mail, gera o link e troca pelo par de tokens", async () => {
    const { impl, calls } = fakeFetch(HAPPY)
    const session = await mintSession(USER, impl)

    expect(session.accessToken).toBe("access-1")
    expect(session.refreshToken).toBe("refresh-1")
    expect(session.expiresAt).toBeGreaterThan(Date.now())
    expect(calls.some((c) => c.includes(`/auth/v1/admin/users/${USER}`))).toBe(true)
    expect(calls.some((c) => c.includes("/auth/v1/verify"))).toBe(true)
  })

  it("falha claro quando o usuário não existe", async () => {
    const { impl } = fakeFetch({ "/auth/v1/admin/users/": { status: 404 } })
    await expect(mintSession(USER, impl)).rejects.toThrow(/não encontrado/)
  })

  it("falha claro quando generate_link não devolve hashed_token", async () => {
    const { impl } = fakeFetch({
      "/auth/v1/admin/users/": { body: { email: "ana@example.com" } },
      "/auth/v1/admin/generate_link": { body: {} },
    })
    await expect(mintSession(USER, impl)).rejects.toThrow(/hashed_token/)
  })
})

describe("refreshSession", () => {
  it("devolve o par novo", async () => {
    const { impl } = fakeFetch({
      "grant_type=refresh_token": {
        body: { access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 },
      },
    })
    const session = await refreshSession("refresh-1", impl)
    expect(session?.accessToken).toBe("access-2")
  })

  it("devolve null quando o refresh token não vale mais", async () => {
    const { impl } = fakeFetch({ "grant_type=refresh_token": { status: 400 } })
    expect(await refreshSession("revogado", impl)).toBeNull()
  })
})

describe("getAccessToken", () => {
  it("cunha uma vez e serve do cache na segunda chamada", async () => {
    const { impl, calls } = fakeFetch(HAPPY)

    expect(await getAccessToken(USER, impl)).toBe("access-1")
    const afterFirst = calls.length
    expect(await getAccessToken(USER, impl)).toBe("access-1")

    expect(calls.length).toBe(afterFirst)
  })

  it("renova em vez de cunhar quando o token cacheado envelheceu", async () => {
    const { impl } = fakeFetch({
      ...HAPPY,
      "/auth/v1/verify": {
        body: { access_token: "access-curto", refresh_token: "refresh-1", expires_in: 10 },
      },
      "grant_type=refresh_token": {
        body: { access_token: "access-renovado", refresh_token: "refresh-2", expires_in: 3600 },
      },
    })

    expect(await getAccessToken(USER, impl)).toBe("access-curto")
    // expires_in de 10s cai dentro da margem, então a próxima chamada renova.
    expect(await getAccessToken(USER, impl)).toBe("access-renovado")
  })

  it("cunha do zero quando o refresh token foi revogado", async () => {
    const { impl } = fakeFetch({
      ...HAPPY,
      "/auth/v1/verify": {
        body: { access_token: "access-curto", refresh_token: "refresh-1", expires_in: 10 },
      },
      "grant_type=refresh_token": { status: 400 },
    })

    expect(await getAccessToken(USER, impl)).toBe("access-curto")
    // Renovação falha → volta a cunhar, e o mint devolve access-curto de novo.
    expect(await getAccessToken(USER, impl)).toBe("access-curto")
  })
})
