import type { User } from '@open-mercato/core/modules/auth/data/entities'
import type { OauthIdentity, OauthTokenResponse } from '../verifiers/oauth/providers.js'
import type { FindOrCreateOauthUserResult } from '../verifiers/oauth/find-or-create-oauth-user.js'

/**
 * Adapter between credential verifiers and wherever client users live.
 * v1 ships exactly one implementation — core `auth` users (see
 * ./core-auth.ts) — but the seam exists so a `customer_accounts`-backed
 * store can follow without touching the verifiers.
 *
 * The surface is intentionally minimal: only what the ported OAuth flow
 * needs today. Password login / signup (SPEC-055 Phase 2) will extend this
 * interface when those endpoints land — expected additions:
 *
 *   findByEmail(email: string): Promise<User | null>
 *   verifyPassword(email: string, password: string): Promise<User | null>
 */
export interface UserStore {
  findOrCreateFromOauth(params: {
    identity: OauthIdentity
    tokens: OauthTokenResponse | null
  }): Promise<FindOrCreateOauthUserResult>
}

export type { User, OauthIdentity, OauthTokenResponse, FindOrCreateOauthUserResult }
