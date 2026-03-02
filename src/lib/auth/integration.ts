import { NextRequest } from 'next/server'

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
  if (scheme !== 'Bearer' || token !== secret) return null

  return userId
}
