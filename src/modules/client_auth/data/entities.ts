import { type Opt } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

/**
 * OAuth provider links (Google / Apple) for a core `auth` user. One row per
 * (provider, providerUserId). Hosts migrating from a hand-rolled `better_auth`
 * app module rename their existing `better_auth_oauth_accounts` table to this
 * name during adoption (a data-preserving `ALTER TABLE ... RENAME`).
 */
@Entity({ tableName: 'client_auth_oauth_accounts' })
@Unique({ name: 'client_auth_oauth_accounts_provider_subject_uq', properties: ['provider', 'providerUserId'] })
export class OauthAccount {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'user_id', type: 'uuid' })
  @Index({ name: 'client_auth_oauth_accounts_user_idx' })
  userId!: string

  @Property({ type: 'text' })
  provider!: string

  @Property({ name: 'provider_user_id', type: 'text' })
  providerUserId!: string

  @Property({ name: 'access_token_hash', type: 'text', nullable: true })
  accessTokenHash?: string | null

  @Property({ name: 'refresh_token_hash', type: 'text', nullable: true })
  refreshTokenHash?: string | null

  @Property({ name: 'access_token_expires_at', type: Date, nullable: true })
  accessTokenExpiresAt?: Date | null

  @Property({ type: 'text', nullable: true })
  scope?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date & Opt = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date & Opt = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
