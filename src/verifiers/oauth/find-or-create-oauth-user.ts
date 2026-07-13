import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { createCoreUser } from '../../stores/create-user.js'
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

  const user = await createCoreUser(em, { email: identity.email, name: identity.name })
  if (!user) return { kind: 'error', reason: 'no-tenant' }
  return { kind: 'ok', user, isNewUser: true }
}

function applyTokens(account: OauthAccount, tokens: OauthTokenResponse | null): void {
  if (!tokens) return
  if (tokens.accessToken) account.accessTokenHash = hashToken(tokens.accessToken)
  if (tokens.refreshToken) account.refreshTokenHash = hashToken(tokens.refreshToken)
  if (tokens.expiresIn) account.accessTokenExpiresAt = new Date(Date.now() + tokens.expiresIn * 1000)
  if (tokens.scope) account.scope = tokens.scope
}
