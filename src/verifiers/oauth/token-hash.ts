import crypto from 'node:crypto'

/**
 * Provider access/refresh tokens are stored hashed at rest. The platform
 * never calls providers on the user's behalf after sign-in, so a one-way
 * digest is enough — it only proves a token was issued.
 */
export function hashToken(token: string | null | undefined): string | null {
  if (!token) return null
  return crypto.createHash('sha256').update(token).digest('hex')
}
