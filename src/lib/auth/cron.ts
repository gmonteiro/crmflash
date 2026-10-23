import { timingSafeEqual } from "crypto"

/**
 * A Vercel manda `Authorization: Bearer ${CRON_SECRET}` nas chamadas de cron.
 * Chamada manual (curl) usa o mesmo cabeçalho. Sem CRON_SECRET configurado,
 * nada passa.
 */
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = request.headers.get("authorization") ?? ""
  const expected = `Bearer ${secret}`
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
