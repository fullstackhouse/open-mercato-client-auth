import type { EntityManager } from '@mikro-orm/postgresql'
import type { User } from '@open-mercato/core/modules/auth/data/entities'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'

/**
 * The public shape of a signed-in user returned by the JSON session endpoints
 * (login / signup / session). Mirrors SPEC-055 §B's `AppSession.user` plus the
 * tenancy scope the frontend needs. Never includes password material.
 */
export type UserView = {
  id: string
  email: string
  name: string | null
  roles: string[]
  tenantId: string | null
  orgId: string | null
}

/**
 * Serializes a core `User` into a `UserView`. Roles are resolved for the
 * user's own tenant unless already known (whoami passes the canonical roles
 * from the validated JWT, avoiding a redundant query).
 */
export async function toUserView(em: EntityManager, user: User, roles?: string[]): Promise<UserView> {
  const tenantId = user.tenantId ? String(user.tenantId) : null
  const resolvedRoles = roles ?? (await new AuthService(em).getUserRoles(user, tenantId))
  return {
    id: String(user.id),
    email: user.email,
    name: user.name ?? null,
    roles: resolvedRoles,
    tenantId,
    orgId: user.organizationId ? String(user.organizationId) : null,
  }
}
