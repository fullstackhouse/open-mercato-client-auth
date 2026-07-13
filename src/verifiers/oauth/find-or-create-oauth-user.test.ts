import type { EntityManager } from '@mikro-orm/postgresql'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { OauthAccount } from '../../modules/client_auth/data/entities.js'
import type { OauthIdentity } from './providers.js'
import { findOrCreateOauthUser } from './find-or-create-oauth-user.js'

const { mockFindUsersByEmail, mockEmitClientAuthEvent } = vi.hoisted(() => ({
  mockFindUsersByEmail: vi.fn(),
  mockEmitClientAuthEvent: vi.fn(),
}))

vi.mock('@open-mercato/core/modules/auth/services/authService', () => ({
  AuthService: vi.fn().mockImplementation(() => ({
    findUsersByEmail: mockFindUsersByEmail,
  })),
}))

vi.mock('@open-mercato/shared/lib/encryption/toggles', () => ({
  isTenantDataEncryptionEnabled: () => false,
}))

vi.mock('../../modules/client_auth/events.js', () => ({
  emitClientAuthEvent: (...args: unknown[]) => mockEmitClientAuthEvent(...args),
}))

type FindOneHandler = (where: Record<string, unknown>) => unknown

function createMockEm(handlers: Map<unknown, FindOneHandler>) {
  const created: Array<{ entity: unknown; data: Record<string, unknown> }> = []
  const em = {
    findOne: vi.fn(async (entity: unknown, where: Record<string, unknown>) => {
      const handler = handlers.get(entity)
      return handler ? (handler(where) ?? null) : null
    }),
    create: vi.fn((entity: unknown, data: Record<string, unknown>) => {
      const record = { id: `created-${created.length + 1}`, ...data }
      created.push({ entity, data: record })
      return record
    }),
    flush: vi.fn(async () => undefined),
  }
  return { em: em as unknown as EntityManager, created, raw: em }
}

const identity: OauthIdentity = {
  provider: 'google',
  providerUserId: 'google-sub-1',
  email: 'player@example.com',
  emailVerified: true,
  name: 'Player One',
}

const tokens = {
  accessToken: 'at-raw',
  refreshToken: 'rt-raw',
  expiresIn: 3600,
  scope: 'openid email',
  idToken: 'idt',
}

describe('findOrCreateOauthUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('signs in an already-linked user and refreshes token hashes', async () => {
    const account: Record<string, unknown> = { id: 'acc-1', userId: 'user-1' }
    const user = { id: 'user-1', tenantId: 'tenant-1' }
    const { em, raw } = createMockEm(
      new Map<unknown, FindOneHandler>([
        [OauthAccount, () => account],
        [User, () => user],
      ]),
    )

    const result = await findOrCreateOauthUser({ em, identity, tokens })

    expect(result).toEqual({ kind: 'ok', user, isNewUser: false })
    expect(account.accessTokenHash).toEqual(expect.any(String))
    expect(account.accessTokenHash).not.toBe('at-raw')
    expect(account.refreshTokenHash).not.toBe('rt-raw')
    expect(raw.create).not.toHaveBeenCalled()
    expect(mockEmitClientAuthEvent).not.toHaveBeenCalled()
  })

  test('links the provider identity to an existing user with the same email', async () => {
    const user = { id: 'user-2', tenantId: 'tenant-1' }
    mockFindUsersByEmail.mockResolvedValue([user])
    const { em, created } = createMockEm(new Map([[OauthAccount, () => null]]))

    const result = await findOrCreateOauthUser({ em, identity, tokens })

    expect(result).toEqual({ kind: 'ok', user, isNewUser: false })
    const accountRow = created.find((c) => c.entity === OauthAccount)
    expect(accountRow?.data).toMatchObject({
      userId: 'user-2',
      provider: 'google',
      providerUserId: 'google-sub-1',
    })
    expect(accountRow?.data.accessTokenHash).not.toBe('at-raw')
    expect(mockEmitClientAuthEvent).toHaveBeenCalledTimes(1)
    expect(mockEmitClientAuthEvent).toHaveBeenCalledWith('client_auth.oauth_account.linked', {
      userId: 'user-2',
      provider: 'google',
      isNewUser: false,
    })
  })

  test('creates a confirmed user in the default tenant when no account matches', async () => {
    mockFindUsersByEmail.mockResolvedValue([])
    const { em, created } = createMockEm(
      new Map<unknown, FindOneHandler>([
        [OauthAccount, () => null],
        [Tenant, () => ({ id: 'tenant-default' })],
      ]),
    )

    const result = await findOrCreateOauthUser({ em, identity, tokens })

    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.isNewUser).toBe(true)

    const userRow = created.find((c) => c.entity === User)
    expect(userRow?.data).toMatchObject({
      email: 'player@example.com',
      tenantId: 'tenant-default',
      organizationId: null,
      name: 'Player One',
      isConfirmed: true,
    })
    expect(userRow?.data.emailHash).toEqual(expect.any(String))

    expect(mockEmitClientAuthEvent).toHaveBeenCalledWith(
      'client_auth.user.signed_up',
      expect.objectContaining({ provider: 'google', email: 'player@example.com' }),
    )
    expect(mockEmitClientAuthEvent).toHaveBeenCalledWith(
      'client_auth.oauth_account.linked',
      expect.objectContaining({ isNewUser: true }),
    )
  })

  test('refuses to link when the provider email is not verified', async () => {
    const { em } = createMockEm(new Map([[OauthAccount, () => null]]))
    const result = await findOrCreateOauthUser({
      em,
      identity: { ...identity, emailVerified: false },
      tokens: null,
    })
    expect(result).toEqual({ kind: 'error', reason: 'email-unverified' })
  })

  test('refuses to sign in when the token carries no email', async () => {
    const { em } = createMockEm(new Map([[OauthAccount, () => null]]))
    const result = await findOrCreateOauthUser({
      em,
      identity: { ...identity, email: null },
      tokens: null,
    })
    expect(result).toEqual({ kind: 'error', reason: 'email-missing' })
  })

  test('refuses to link when the email matches several users', async () => {
    mockFindUsersByEmail.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    const { em } = createMockEm(new Map([[OauthAccount, () => null]]))
    const result = await findOrCreateOauthUser({ em, identity, tokens: null })
    expect(result).toEqual({ kind: 'error', reason: 'email-ambiguous' })
  })

  test('fails cleanly when no tenant exists yet', async () => {
    mockFindUsersByEmail.mockResolvedValue([])
    const { em } = createMockEm(
      new Map<unknown, FindOneHandler>([
        [OauthAccount, () => null],
        [Tenant, () => null],
      ]),
    )
    const result = await findOrCreateOauthUser({ em, identity, tokens: null })
    expect(result).toEqual({ kind: 'error', reason: 'no-tenant' })
  })
})
