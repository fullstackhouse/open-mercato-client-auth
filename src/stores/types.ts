import type { User } from '@open-mercato/core/modules/auth/data/entities'
import type { OauthIdentity, OauthTokenResponse } from '../verifiers/oauth/providers.js'
import type { FindOrCreateOauthUserResult } from '../verifiers/oauth/find-or-create-oauth-user.js'

/**
 * Adapter between credential verifiers and wherever client users live.
 * v1 ships exactly one implementation — core `auth` users (see
 * ./core-auth.ts) — but the seam exists so a `customer_accounts`-backed
 * store can follow without touching the verifiers.
 *
 * v1 ships one implementation (core `auth` users). The password/signup
 * endpoints (SPEC-055 §D) extend it with the credential + creation surface
 * below; a future `customer_accounts` store implements the same interface.
 */
export type CreateUserResult =
  | { kind: 'ok'; user: User }
  | { kind: 'error'; reason: 'email-taken' | 'no-tenant' }

export interface UserStore {
  findOrCreateFromOauth(params: {
    identity: OauthIdentity
    tokens: OauthTokenResponse | null
  }): Promise<FindOrCreateOauthUserResult>

  /** Resolves the verified user for an email/password pair, or null. */
  verifyCredentials(email: string, password: string): Promise<User | null>

  /**
   * Creates a new client user with the base role. `email-taken` when an
   * account already exists (signup does not enumerate via timing but does
   * report the conflict to the caller).
   */
  createUser(params: { email: string; password: string; name?: string | null }): Promise<CreateUserResult>
}

export type { User, OauthIdentity, OauthTokenResponse, FindOrCreateOauthUserResult }
