import { createHash, randomBytes, timingSafeEqual } from "crypto"

/** Token opaco. 32 bytes = 256 bits, o mesmo porte de um segredo de sessão. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url")
}

// O banco guarda só isto. Vazar a tabela não pode virar acesso, e um hash sem
// salt basta: o valor de entrada já é aleatório de 256 bits, então não há
// dicionário para atacar.
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/**
 * PKCE S256: challenge = base64url(sha256(verifier)).
 *
 * É o que amarra quem pediu o code a quem o troca por token. Sem isso, um code
 * interceptado no redirect vale para qualquer um.
 */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false

  const computed = createHash("sha256").update(verifier).digest("base64url")
  const a = Buffer.from(computed)
  const b = Buffer.from(challenge)
  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}
