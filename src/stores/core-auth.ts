import type { EntityManager } from '@mikro-orm/postgresql'
import {
  findOrCreateOauthUser,
  type FindOrCreateOauthUserResult,
} from '../verifiers/oauth/find-or-create-oauth-user.js'
import type { OauthIdentity, OauthTokenResponse } from '../verifiers/oauth/providers.js'
import type { UserStore } from './types.js'

/**
 * The v1 user store: client users are core `auth` users ("customer" is a
 * role with zero backend features, not a separate table). OAuth identities
 * link to users via the `better_auth_oauth_accounts` extension table; core
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
}

export function createCoreAuthUserStore(em: EntityManager): CoreAuthUserStore {
  return new CoreAuthUserStore(em)
}
