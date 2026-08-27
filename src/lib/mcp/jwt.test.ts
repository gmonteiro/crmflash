import { describe, it, expect, beforeAll } from "vitest"
import { jwtVerify } from "jose"
import { signSupabaseJwt } from "./jwt"

const SECRET = "segredo-de-teste-com-tamanho-suficiente-para-hs256"

beforeAll(() => {
  process.env.SUPABASE_JWT_SECRET = SECRET
})

describe("signSupabaseJwt", () => {
  it("assina um token que o segredo verifica, com as claims que a RLS lê", async () => {
    const token = await signSupabaseJwt("11111111-1111-1111-1111-111111111111")
    const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET))

    expect(payload.sub).toBe("11111111-1111-1111-1111-111111111111")
    expect(payload.role).toBe("authenticated")
    expect(payload.aud).toBe("authenticated")
  })

  it("expira no prazo pedido", async () => {
    const token = await signSupabaseJwt("11111111-1111-1111-1111-111111111111", 60)
    const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET))
    const ttl = (payload.exp as number) - (payload.iat as number)

    expect(ttl).toBe(60)
  })

  it("recusa assinar sem o segredo configurado", async () => {
    delete process.env.SUPABASE_JWT_SECRET
    await expect(signSupabaseJwt("11111111-1111-1111-1111-111111111111")).rejects.toThrow(
      /SUPABASE_JWT_SECRET/
    )
    process.env.SUPABASE_JWT_SECRET = SECRET
  })
})
