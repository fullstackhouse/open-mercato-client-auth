import type { EntityManager } from '@mikro-orm/postgresql'
import { createCoreAuthUserStore } from './core-auth.js'

const { mockFindUsersByEmail, mockCreateCoreUser, mockEmit } = vi.hoisted(() => ({
  mockFindUsersByEmail: vi.fn(),
  mockCreateCoreUser: vi.fn(),
  mockEmit: vi.fn(),
}))

vi.mock('@open-mercato/core/modules/auth/services/authService', () => ({
  AuthService: vi.fn().mockImplementation(() => ({ findUsersByEmail: mockFindUsersByEmail })),
}))

vi.mock('./create-user.js', () => ({
  createCoreUser: (...args: unknown[]) => mockCreateCoreUser(...args),
}))

vi.mock('../modules/client_auth/events.js', () => ({
  emitClientAuthEvent: (...args: unknown[]) => mockEmit(...args),
}))

const em = {} as unknown as EntityManager
const store = createCoreAuthUserStore(em)

describe('CoreAuthUserStore.createUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('rejects an email that already has an account', async () => {
    mockFindUsersByEmail.mockResolvedValue([{ id: 'existing' }])

    await expect(store.createUser({ email: 'taken@example.com', password: 'secret123' })).resolves.toEqual({
      kind: 'error',
      reason: 'email-taken',
    })
    expect(mockCreateCoreUser).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  test('creates the user and emits signed_up on success', async () => {
    mockFindUsersByEmail.mockResolvedValue([])
    const user = { id: 'user-1', tenantId: 'tenant-1' }
    mockCreateCoreUser.mockResolvedValue(user)

    const result = await store.createUser({ email: 'new@example.com', password: 'secret123', name: 'New Player' })

    expect(result).toEqual({ kind: 'ok', user })
    expect(mockEmit).toHaveBeenCalledWith('client_auth.user.signed_up', {
      userId: 'user-1',
      email: 'new@example.com',
      name: 'New Player',
      provider: null,
      tenantId: 'tenant-1',
    })
  })

  test('surfaces no-tenant when creation cannot resolve a tenant', async () => {
    mockFindUsersByEmail.mockResolvedValue([])
    mockCreateCoreUser.mockResolvedValue(null)

    await expect(store.createUser({ email: 'new@example.com', password: 'secret123' })).resolves.toEqual({
      kind: 'error',
      reason: 'no-tenant',
    })
    expect(mockEmit).not.toHaveBeenCalled()
  })
})
