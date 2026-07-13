import type { EntityManager } from '@mikro-orm/postgresql'
import type { User } from '@open-mercato/core/modules/auth/data/entities'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { signJwt } from '@open-mercato/shared/lib/auth/jwt'
import { getSessionDays } from '../config.js'

// Lifetime of the access JWT — matches core `signJwt`'s default (8h) and the
// `auth_token` cookie max-age. This is what clients treat as the session
// `expiresAt` for refresh timing; the refresh token lives far longer.
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 8

export type IssuedSession = {
  token: string
  refreshToken: string
  /** Access-token (JWT) expiry — the client-facing session `expiresAt`. */
  accessExpiresAt: Date
  /** Refresh-token / session-row expiry — drives the `session_token` cookie. */
  refreshExpiresAt: Date
}

/**
 * Signs the short-lived core access JWT for a user against an existing session
 * row. Shared by `issueSession` (new session) and the refresh endpoint (which
 * re-signs against the session the refresh token already points at, without
 * minting a new session). Claims match core's own login token exactly so
 * `getAuthFromRequest` accepts it unchanged.
 */
export function buildAccessToken(user: User, sessionId: string, roles: string[]): string {
  return signJwt(
    {
      sub: String(user.id),
      sid: String(sessionId),
      tenantId: user.tenantId ? String(user.tenantId) : null,
      orgId: user.organizationId ? String(user.organizationId) : null,
      email: user.email,
      roles,
    },
    undefined,
    ACCESS_TOKEN_TTL_SECONDS,
  )
}

export function accessTokenExpiry(): Date {
  return new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000)
}

/**
 * The single seam every credential verifier funnels into (SPEC-055 §D):
 * a verified core `User` goes in, a platform session (core JWT + refresh
 * token) comes out. Cookie/body emission is the transport's job — see
 * ./transports.ts.
 */
export async function issueSession(em: EntityManager, user: User): Promise<IssuedSession> {
  const authService = new AuthService(em)
  const roles = await authService.getUserRoles(user, user.tenantId ? String(user.tenantId) : null)

  const refreshExpiresAt = new Date(Date.now() + getSessionDays() * 24 * 60 * 60 * 1000)
  const { session, token: refreshToken } = await authService.createSession(user, refreshExpiresAt)

  await authService.updateLastLoginAt(user)

  const token = buildAccessToken(user, String(session.id), roles)

  return { token, refreshToken, accessExpiresAt: accessTokenExpiry(), refreshExpiresAt }
}
