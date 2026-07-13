import { hash } from 'bcryptjs'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Role, User, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { computeEmailHash } from '@open-mercato/core/modules/auth/lib/emailHash'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { createKmsService } from '@open-mercato/shared/lib/encryption/kms'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'
import { getDefaultRoleName } from '../config.js'

// Matches core auth's bcrypt cost factor (authService.confirmPasswordReset).
const BCRYPT_ROUNDS = 10

export type CreateCoreUserParams = {
  email: string
  name?: string | null
  /** Bcrypt-hashed and stored when present; omit for OAuth-only accounts. */
  password?: string | null
  /**
   * Role granted to the new user, defaulting to `CLIENT_AUTH_DEFAULT_ROLE`.
   * A role that can't be found in the user's tenant is skipped (logged), so a
   * misconfigured role name never blocks account creation.
   */
  roleName?: string | null
}

/**
 * Creates a confirmed core `auth` user in the default tenant — the shared
 * primitive behind both password signup and first-time OAuth sign-in. Email is
 * encrypted per the host's tenant-data-encryption toggle, the password (if
 * any) is bcrypt-hashed, and the configured base role is granted. Returns
 * `null` when no active tenant exists yet.
 */
export async function createCoreUser(em: EntityManager, params: CreateCoreUserParams): Promise<User | null> {
  const tenant = await em.findOne(
    Tenant,
    { deletedAt: null, isActive: true },
    { orderBy: { createdAt: 'ASC' } },
  )
  if (!tenant) return null
  const tenantId = String(tenant.id)

  const emailPayload = await encryptEmailPayload(em, params.email, tenantId)
  const passwordHash = params.password ? await hash(params.password, BCRYPT_ROUNDS) : undefined
  const user = em.create(User, {
    email: emailPayload.email,
    emailHash: emailPayload.emailHash,
    tenantId,
    organizationId: null,
    name: params.name ?? undefined,
    passwordHash,
    isConfirmed: true,
    createdAt: new Date(),
  })
  await em.flush()

  const roleName = params.roleName === undefined ? getDefaultRoleName() : params.roleName
  if (roleName) await grantRole(em, user, tenantId, roleName)

  return user
}

async function grantRole(em: EntityManager, user: User, tenantId: string, roleName: string): Promise<void> {
  const role = await em.findOne(Role, { name: roleName, tenantId, deletedAt: null })
  if (!role) {
    console.warn(`[client_auth] default role "${roleName}" not found in tenant ${tenantId}; user created without a role`)
    return
  }
  em.create(UserRole, { user, role, createdAt: new Date() })
  await em.flush()
}

async function encryptEmailPayload(
  em: EntityManager,
  email: string,
  tenantId: string,
): Promise<{ email: string; emailHash: string }> {
  if (!isTenantDataEncryptionEnabled()) {
    return { email, emailHash: computeEmailHash(email) }
  }
  const encryptionService = new TenantDataEncryptionService(em as never, { kms: createKmsService() })
  const payload = (await encryptionService.encryptEntityPayload('auth:user', { email }, tenantId, null)) as {
    email?: string
    emailHash?: string
  }
  return {
    email: payload.email ?? email,
    emailHash: payload.emailHash ?? computeEmailHash(email),
  }
}
