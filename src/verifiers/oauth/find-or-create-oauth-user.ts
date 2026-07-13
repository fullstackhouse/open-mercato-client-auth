import type { EntityManager } from '@mikro-orm/postgresql'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { computeEmailHash } from '@open-mercato/core/modules/auth/lib/emailHash'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'
import { createKmsService } from '@open-mercato/shared/lib/encryption/kms'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { OauthAccount } from '../../modules/client_auth/data/entities.js'
import { emitClientAuthEvent } from '../../modules/client_auth/events.js'
import type { OauthIdentity, OauthTokenResponse } from './providers.js'
import { hashToken } from './token-hash.js'

export type FindOrCreateOauthUserResult =
  | { kind: 'ok'; user: User; isNewUser: boolean }
  | { kind: 'error'; reason: 'email-missing' | 'email-unverified' | 'email-ambiguous' | 'no-tenant' }

export async function findOrCreateOauthUser(params: {
  em: EntityManager
  identity: OauthIdentity
  tokens: OauthTokenResponse | null
}): Promise<FindOrCreateOauthUserResult> {
  const { em, identity, tokens } = params

  const account = await em.findOne(OauthAccount, {
    provider: identity.provider,
    providerUserId: identity.providerUserId,
    deletedAt: null,
  })

  if (account) {
    const user = await em.findOne(User, { id: account.userId, deletedAt: null })
    if (user) {
      applyTokens(account, tokens)
      await em.flush()
      return { kind: 'ok', user, isNewUser: false }
    }
    account.deletedAt = new Date()
    await em.flush()
  }

  const resolved = await resolveUserByEmail(em, identity)
  if (resolved.kind === 'error') return resolved

  const { user, isNewUser } = resolved
  const oauthAccount = em.create(OauthAccount, {
    userId: user.id,
    provider: identity.provider,
    providerUserId: identity.providerUserId,
  })
  applyTokens(oauthAccount, tokens)
  await em.flush()

  if (isNewUser) {
    await emitClientAuthEvent('client_auth.user.signed_up', {
      userId: String(user.id),
      email: identity.email,
      name: identity.name,
      provider: identity.provider,
      tenantId: user.tenantId ? String(user.tenantId) : null,
    })
  }
  await emitClientAuthEvent('client_auth.oauth_account.linked', {
    userId: String(user.id),
    provider: identity.provider,
    isNewUser,
  })

  return { kind: 'ok', user, isNewUser }
}

type ResolveUserResult =
  | { kind: 'ok'; user: User; isNewUser: boolean }
  | { kind: 'error'; reason: 'email-missing' | 'email-unverified' | 'email-ambiguous' | 'no-tenant' }

async function resolveUserByEmail(em: EntityManager, identity: OauthIdentity): Promise<ResolveUserResult> {
  if (!identity.email) return { kind: 'error', reason: 'email-missing' }
  if (!identity.emailVerified) return { kind: 'error', reason: 'email-unverified' }

  const authService = new AuthService(em)
  const existing = await authService.findUsersByEmail(identity.email)
  if (existing.length > 1) return { kind: 'error', reason: 'email-ambiguous' }
  if (existing.length === 1) return { kind: 'ok', user: existing[0], isNewUser: false }

  const user = await createUser(em, identity.email, identity.name)
  if (!user) return { kind: 'error', reason: 'no-tenant' }
  return { kind: 'ok', user, isNewUser: true }
}

async function createUser(em: EntityManager, email: string, name: string | null): Promise<User | null> {
  const tenant = await em.findOne(
    Tenant,
    { deletedAt: null, isActive: true },
    { orderBy: { createdAt: 'ASC' } },
  )
  if (!tenant) return null
  const tenantId = String(tenant.id)

  const emailPayload = await encryptEmailPayload(em, email, tenantId)
  const user = em.create(User, {
    email: emailPayload.email,
    emailHash: emailPayload.emailHash,
    tenantId,
    organizationId: null,
    name: name ?? undefined,
    isConfirmed: true,
    createdAt: new Date(),
  })
  await em.flush()
  return user
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

function applyTokens(account: OauthAccount, tokens: OauthTokenResponse | null): void {
  if (!tokens) return
  if (tokens.accessToken) account.accessTokenHash = hashToken(tokens.accessToken)
  if (tokens.refreshToken) account.refreshTokenHash = hashToken(tokens.refreshToken)
  if (tokens.expiresIn) account.accessTokenExpiresAt = new Date(Date.now() + tokens.expiresIn * 1000)
  if (tokens.scope) account.scope = tokens.scope
}
