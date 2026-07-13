import type { EntityManager } from '@mikro-orm/postgresql'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import {
  findOrCreateOauthUser,
  type FindOrCreateOauthUserResult,
} from '../verifiers/oauth/find-or-create-oauth-user.js'
import type { OauthIdentity, OauthTokenResponse } from '../verifiers/oauth/providers.js'
import { verifyCredentials } from '../verifiers/password/verify-credentials.js'
import { emitClientAuthEvent } from '../modules/client_auth/events.js'
import { createCoreUser } from './create-user.js'
import type { CreateUserResult, UserStore, User } from './types.js'

/**
 * The v1 user store: client users are core `auth` users ("customer" is a
 * role with zero backend features, not a separate table). OAuth identities
 * link to users via the `client_auth_oauth_accounts` extension table; core
 * auth tables are never modified.
 */
export class CoreAuthUserStore implements UserStore {
  constructor(private readonly em: EntityManager) {}

  findOrCreateFromOauth(params: {
    identity: OauthIdentity
    tokens: OauthTokenResponse | null
  }): Promise<FindOrCreateOauthUserResult> {
    return findOrCreateOauthUser({ em: this.em, ...params })
  }

  verifyCredentials(email: string, password: string): Promise<User | null> {
    return verifyCredentials(this.em, email, password)
  }

  async createUser(params: { email: string; password: string; name?: string | null }): Promise<CreateUserResult> {
    const existing = await new AuthService(this.em).findUsersByEmail(params.email)
    if (existing.length > 0) return { kind: 'error', reason: 'email-taken' }

    const user = await createCoreUser(this.em, params)
    if (!user) return { kind: 'error', reason: 'no-tenant' }

    await emitClientAuthEvent('client_auth.user.signed_up', {
      userId: String(user.id),
      email: params.email,
      name: params.name ?? null,
      provider: null,
      tenantId: user.tenantId ? String(user.tenantId) : null,
    })
    return { kind: 'ok', user }
  }
}

export function createCoreAuthUserStore(em: EntityManager): CoreAuthUserStore {
  return new CoreAuthUserStore(em)
}
