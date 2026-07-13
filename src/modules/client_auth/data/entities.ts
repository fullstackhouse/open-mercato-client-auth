import { type Opt } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

/**
 * The table keeps its historical `better_auth_*` name so hosts migrating from
 * a hand-rolled better_auth app module (e.g. Tournee) adopt their existing
 * OAuth links without a data migration. Only the module id changed.
 */
@Entity({ tableName: 'better_auth_oauth_accounts' })
@Unique({ name: 'better_auth_oauth_accounts_provider_subject_uq', properties: ['provider', 'providerUserId'] })
export class OauthAccount {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'user_id', type: 'uuid' })
  @Index({ name: 'better_auth_oauth_accounts_user_idx' })
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
