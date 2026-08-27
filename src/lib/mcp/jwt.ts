import { SignJWT } from "jose"

// O JWT que faz a RLS existente valer para o MCP.
//
// Assinar com o mesmo segredo do Supabase Auth é o que faz auth.uid() devolver
// o usuário certo — e, com ele, current_workspace() escopar toda query sem que
// nenhuma tool precise lembrar de filtrar. É a alternativa ao service role do
// /api/integration/*, que escopa na mão.
export async function signSupabaseJwt(
  userId: string,
  ttlSeconds = 300
): Promise<string> {
  const secret = process.env.SUPABASE_JWT_SECRET
  if (!secret) throw new Error("SUPABASE_JWT_SECRET não configurado")

  const now = Math.floor(Date.now() / 1000)

  return new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setAudience("authenticated")
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(new TextEncoder().encode(secret))
}
