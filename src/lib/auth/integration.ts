import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'

/**
 * Validates the integration shared secret from the Authorization header.
 * Returns the configured user_id if valid, null otherwise.
 */
export function validateIntegrationAuth(request: NextRequest): string | null {
  const secret = process.env.INTEGRATION_SECRET
  const userId = process.env.INTEGRATION_USER_ID

  if (!secret || !userId) return null

  const authHeader = request.headers.get('authorization')
  if (!authHeader) return null

  const [scheme, token] = authHeader.split(' ')
  if (scheme !== 'Bearer' || !token) return null

  const tokenBuf = Buffer.from(token)
  const secretBuf = Buffer.from(secret)
  if (tokenBuf.length !== secretBuf.length || !timingSafeEqual(tokenBuf, secretBuf))
    return null

  return userId
}
