import type { EntityManager } from '@mikro-orm/postgresql'
import type { User } from '@open-mercato/core/modules/auth/data/entities'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'

/**
 * The password credential verifier (SPEC-055 §D): resolves the verified core
 * `User` for an email/password pair, or `null` on any failure. Delegates to
 * core `AuthService.verifyPassword`, whose bcrypt compare runs against a
 * constant timing-equalizer hash when the user is missing or has no password —
 * so a wrong email and a wrong password take the same time (anti-enumeration),
 * and the caller returns one generic error for both.
 */
export async function verifyCredentials(em: EntityManager, email: string, password: string): Promise<User | null> {
  const authService = new AuthService(em)
  const user = await authService.findUserByEmail(email)
  const ok = await authService.verifyPassword(user, password)
  return ok ? user : null
}
