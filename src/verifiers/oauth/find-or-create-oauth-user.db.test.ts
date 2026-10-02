// First-time OAuth sign-in, against a real database.
//
// `find-or-create-oauth-user.test.ts` next door drives a hand-rolled `em` whose `findOne` answers
// from a Map and whose `create` hands back `{ id: 'created-1' }`. That proves the branching — which
// error each bad identity produces, which fields get written — and it cannot prove the two things
// that decide whether a stranger ends up inside somebody else's account:
//
//   1. The queries are real SQL against the real columns, including `deletedAt: null`.
//   2. One OAuth identity maps to one user even when two callbacks arrive at once. The unique index
//      is the only thing enforcing that, and a Map accepts both writes happily.
//
// What is faked here is only what this package does not own: the event bus (it needs the
// application runtime) and the tenant-encryption toggle (it needs a KMS). `AuthService` is upstream
// core's and takes an `em`, so it runs for real — by the ownership rule, our job is to test our
// handling of what it returns (12.8).
//
//   npm run test:db     # testcontainers; or set CLIENT_AUTH_TEST_PG_URL
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { createSuiteDatabase, dropSuiteDatabase } from '../../__db__/suite-database.js'
import { Role, User, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { OauthAccount } from '../../modules/client_auth/data/entities.js'
import type { OauthIdentity } from './providers.js'
import { findOrCreateOauthUser } from './find-or-create-oauth-user.js'

const { mockEmit } = vi.hoisted(() => ({ mockEmit: vi.fn() }))

vi.mock('@open-mercato/shared/lib/encryption/toggles', () => ({
  isTenantDataEncryptionEnabled: () => false,
}))

vi.mock('../../modules/client_auth/events.js', () => ({
  emitClientAuthEvent: (...args: unknown[]) => mockEmit(...args),
}))

const IDENTITY: OauthIdentity = {
  provider: 'google',
  providerUserId: 'google-sub-1',
  email: 'ada@example.com',
  emailVerified: true,
  name: 'Ada Lovelace',
}

let container: StartedPostgreSqlContainer | undefined
let serverUrl: string
let suiteUrl: string
let orm: MikroORM

beforeAll(async () => {
  serverUrl = process.env.CLIENT_AUTH_TEST_PG_URL ?? ''
  if (!serverUrl) {
    container = await new PostgreSqlContainer('postgres:17').start()
    serverUrl = container.getConnectionUri()
  }
  // This suite's own database on that server: the suites each own their schema, so they must
  // not share one. See src/__db__/suite-database.ts.
  suiteUrl = await createSuiteDatabase('client_auth_oauth', serverUrl)
  const url = suiteUrl
  orm = await MikroORM.init({
    clientUrl: url,
    // The core tables this flow touches, plus ours. Built from entity metadata rather than core's
    // migrations: what our own migration does is asserted in migration.db.test.ts, and this suite is
    // about behaviour over real SQL, not about core's DDL.
    entities: [OauthAccount, User, Role, UserRole, Tenant],
    discovery: { warnWhenNoEntities: false },
    logger: () => {},
  })
  // v7 has no `refreshDatabase`: drop then create, which is the same thing spelled out.
  await orm.schema.drop({ dropMigrationsTable: true })
  await orm.schema.create()
}, 180_000)

afterAll(async () => {
  await orm?.close(true)
  if (suiteUrl && !container) await dropSuiteDatabase(suiteUrl, serverUrl)
  await container?.stop()
})

// Clean state before each test rather than after: a crashed predecessor must not poison its
// successor (12.7). A tenant has to exist or `createCoreUser` refuses — that is its documented
// `no-tenant` contract.
afterEach(() => mockEmit.mockReset())

const freshWorld = async (): Promise<EntityManager> => {
  const em = orm.em.fork()
  await em.nativeDelete(OauthAccount, {})
  await em.nativeDelete(UserRole, {})
  await em.nativeDelete(User, {})
  await em.nativeDelete(Tenant, {})
  em.persist(em.create(Tenant, { name: 'Acme', isActive: true } as never))
  await em.flush()
  em.clear()
  return em
}

describe('first-time OAuth sign-in against a real database', () => {
  it('creates the user and the account, and writes only hashed tokens', async () => {
    const em = await freshWorld()

    const result = await findOrCreateOauthUser({
      em,
      identity: IDENTITY,
      tokens: {
        accessToken: 'at-secret',
        refreshToken: 'rt-secret',
        expiresIn: 3600,
        scope: 'openid email',
        idToken: null,
      },
    })

    expect(result).toMatchObject({ kind: 'ok', isNewUser: true })
    // Read back through a fresh fork: a real SELECT, not the identity map answering from memory.
    const stored = await orm.em.fork().findOne(OauthAccount, { provider: 'google', providerUserId: 'google-sub-1' })
    expect(stored?.accessTokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(stored?.refreshTokenHash).toMatch(/^[a-f0-9]{64}$/)
    // The point of hashing: neither secret survives anywhere in the row.
    expect(JSON.stringify(stored)).not.toContain('at-secret')
    expect(JSON.stringify(stored)).not.toContain('rt-secret')
  })

  it('returns the same user on a second sign-in instead of making another one', async () => {
    const em = await freshWorld()
    const first = await findOrCreateOauthUser({ em, identity: IDENTITY, tokens: null })

    const second = await findOrCreateOauthUser({ em: orm.em.fork(), identity: IDENTITY, tokens: null })

    expect(second).toMatchObject({ kind: 'ok', isNewUser: false })
    expect(String((second as { user: User }).user.id)).toBe(String((first as { user: User }).user.id))
    expect(await orm.em.fork().count(User, {})).toBe(1)
    expect(await orm.em.fork().count(OauthAccount, {})).toBe(1)
  })

  it('links a verified identity to the existing user who already owns that email', async () => {
    const em = await freshWorld()
    const tenant = await em.findOneOrFail(Tenant, { isActive: true })
    em.persist(
      em.create(User, {
        email: IDENTITY.email,
        tenantId: tenant.id,
        isConfirmed: true,
      } as never),
    )
    await em.flush()
    em.clear()

    const result = await findOrCreateOauthUser({ em, identity: IDENTITY, tokens: null })

    // Not a new user, and emphatically not a second row for the same address.
    expect(result).toMatchObject({ kind: 'ok', isNewUser: false })
    expect(await orm.em.fork().count(User, { email: IDENTITY.email })).toBe(1)
  })

  // Provider confusion. Google's `sub` and Apple's `sub` are different namespaces, and nothing stops
  // the same string appearing in both — an attacker who can choose their Apple subject would
  // otherwise be handed the Google account that already uses it. The lookup must be keyed on the
  // pair, and this is the test that notices when it is not: without `provider` in the where-clause,
  // the Apple callback returns the Google user and reports `isNewUser: false`.
  it('does not hand an Apple identity the Google account with the same subject', async () => {
    const em = await freshWorld()
    const google = await findOrCreateOauthUser({ em, identity: IDENTITY, tokens: null })

    const apple = await findOrCreateOauthUser({
      em: orm.em.fork(),
      // Same subject string, different provider, and a different person's email.
      identity: { ...IDENTITY, provider: 'apple', email: 'grace@example.com' },
      tokens: null,
    })

    expect(apple).toMatchObject({ kind: 'ok', isNewUser: true })
    expect(String((apple as { user: User }).user.id)).not.toBe(String((google as { user: User }).user.id))
    const accounts = await orm.em.fork().find(OauthAccount, { providerUserId: IDENTITY.providerUserId })
    expect(accounts.map((account) => account.provider).sort()).toEqual(['apple', 'google'])
  })

  it('refuses an unverified email rather than trusting the provider', async () => {
    const em = await freshWorld()

    const result = await findOrCreateOauthUser({
      em,
      identity: { ...IDENTITY, emailVerified: false },
      tokens: null,
    })

    expect(result).toEqual({ kind: 'error', reason: 'email-unverified' })
    expect(await orm.em.fork().count(User, {})).toBe(0)
  })

  // Two callbacks for the same brand-new identity, overlapping — a double-clicked consent screen,
  // or a provider retry. What is asserted is the end state, which is the invariant that matters:
  // one person, one account, and only one of the two callers told the application a user was born.
  //
  // Deliberately NOT asserted: that the unique index rejected the loser. Whether these two
  // overlap at the critical moment is up to the scheduler — in practice the first flush usually
  // lands before the second read, and then the second caller legitimately returns the existing
  // account. The index itself is pinned deterministically in migration.db.test.ts; this test is
  // here for the invariant, not for the mechanism that enforces it.
  it('leaves one user and one account when two callbacks for the same identity overlap', async () => {
    await freshWorld()

    const outcomes = await Promise.allSettled([
      findOrCreateOauthUser({ em: orm.em.fork(), identity: IDENTITY, tokens: null }),
      findOrCreateOauthUser({ em: orm.em.fork(), identity: IDENTITY, tokens: null }),
    ])

    const em = orm.em.fork()
    expect(await em.count(OauthAccount, {})).toBe(1)
    expect(await em.count(User, {})).toBe(1)

    const signups = outcomes.filter(
      (outcome) => outcome.status === 'fulfilled' && (outcome.value as { isNewUser?: boolean }).isNewUser === true,
    )
    expect(signups).toHaveLength(1)
    // And the signup event fires once, so a welcome mail is not sent twice.
    expect(mockEmit.mock.calls.filter(([event]) => event === 'client_auth.user.signed_up')).toHaveLength(1)
  })
})
