import type { EntityManager } from '@mikro-orm/postgresql'
import type { User } from '@open-mercato/core/modules/auth/data/entities'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { signJwt } from '@open-mercato/shared/lib/auth/jwt'
import { getSessionDays } from '../config.js'

export type IssuedSession = {
  token: string
  refreshToken: string
  expiresAt: Date
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

  const expiresAt = new Date(Date.now() + getSessionDays() * 24 * 60 * 60 * 1000)
  const { session, token: refreshToken } = await authService.createSession(user, expiresAt)

  await authService.updateLastLoginAt(user)

  const token = signJwt({
    sub: String(user.id),
    sid: String(session.id),
    tenantId: user.tenantId ? String(user.tenantId) : null,
    orgId: user.organizationId ? String(user.organizationId) : null,
    email: user.email,
    roles,
  })

  return { token, refreshToken, expiresAt }
}
