import { createHash, timingSafeEqual } from "crypto"

/**
 * O coletor local de WhatsApp manda `Authorization: Bearer <token>`. O CRM
 * guarda só o SHA-256 (WHATSAPP_COLLECTOR_TOKEN_SHA256): vazar a env da Vercel
 * não entrega o token. Sem o hash configurado, nada passa.
 */
export function isCollectorAuthorized(request: Request): boolean {
  const expected = process.env.WHATSAPP_COLLECTOR_TOKEN_SHA256?.trim().toLowerCase()
  if (!expected) return false
  const header = request.headers.get("authorization") ?? ""
  if (!header.startsWith("Bearer ")) return false
  const got = createHash("sha256").update(header.slice(7)).digest("hex")
  const a = Buffer.from(got)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
