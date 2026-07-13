import type { EntityManager } from '@mikro-orm/postgresql'
import { Role, User, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { createCoreUser } from './create-user.js'

vi.mock('@open-mercato/shared/lib/encryption/toggles', () => ({
  isTenantDataEncryptionEnabled: () => false,
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
  return { em: em as unknown as EntityManager, created }
}

const activeTenant = { id: 'tenant-default' }

describe('createCoreUser', () => {
  const originalRole = process.env.CLIENT_AUTH_DEFAULT_ROLE

  afterEach(() => {
    if (originalRole === undefined) delete process.env.CLIENT_AUTH_DEFAULT_ROLE
    else process.env.CLIENT_AUTH_DEFAULT_ROLE = originalRole
    vi.clearAllMocks()
  })

  test('creates a confirmed user in the default tenant with a hashed password', async () => {
    delete process.env.CLIENT_AUTH_DEFAULT_ROLE
    const { em, created } = createMockEm(new Map([[Tenant, () => activeTenant]]))

    const user = await createCoreUser(em, { email: 'player@example.com', name: 'Player One', password: 'secret123' })

    expect(user).not.toBeNull()
    const userRow = created.find((c) => c.entity === User)
    expect(userRow?.data).toMatchObject({
      email: 'player@example.com',
      tenantId: 'tenant-default',
      organizationId: null,
      name: 'Player One',
      isConfirmed: true,
    })
    expect(userRow?.data.emailHash).toEqual(expect.any(String))
    expect(String(userRow?.data.passwordHash)).toMatch(/^\$2[aby]\$/)
    expect(created.some((c) => c.entity === UserRole)).toBe(false)
  })

  test('omits the password hash for OAuth-only accounts', async () => {
    delete process.env.CLIENT_AUTH_DEFAULT_ROLE
    const { em, created } = createMockEm(new Map([[Tenant, () => activeTenant]]))

    await createCoreUser(em, { email: 'oauth@example.com', name: null })

    const userRow = created.find((c) => c.entity === User)
    expect(userRow?.data.passwordHash).toBeUndefined()
  })

  test('returns null when no active tenant exists', async () => {
    const { em } = createMockEm(new Map([[Tenant, () => null]]))
    await expect(createCoreUser(em, { email: 'x@example.com' })).resolves.toBeNull()
  })

  test('grants the configured default role when it exists in the tenant', async () => {
    const role = { id: 'role-1', name: 'customer', tenantId: 'tenant-default' }
    const { em, created } = createMockEm(
      new Map<unknown, FindOneHandler>([
        [Tenant, () => activeTenant],
        [Role, (where) => (where.name === 'customer' ? role : null)],
      ]),
    )

    await createCoreUser(em, { email: 'p@example.com', roleName: 'customer' })

    const roleRow = created.find((c) => c.entity === UserRole)
    expect(roleRow?.data).toMatchObject({ role })
  })

  test('skips role assignment (without failing) when the role is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { em, created } = createMockEm(
      new Map<unknown, FindOneHandler>([
        [Tenant, () => activeTenant],
        [Role, () => null],
      ]),
    )

    const user = await createCoreUser(em, { email: 'p@example.com', roleName: 'ghost-role' })

    expect(user).not.toBeNull()
    expect(created.some((c) => c.entity === UserRole)).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  test('falls back to CLIENT_AUTH_DEFAULT_ROLE when no roleName is passed', async () => {
    process.env.CLIENT_AUTH_DEFAULT_ROLE = 'customer'
    const role = { id: 'role-1', name: 'customer', tenantId: 'tenant-default' }
    const findRole = vi.fn((where: Record<string, unknown>) => (where.name === 'customer' ? role : null))
    const { em, created } = createMockEm(
      new Map<unknown, FindOneHandler>([
        [Tenant, () => activeTenant],
        [Role, findRole],
      ]),
    )

    await createCoreUser(em, { email: 'p@example.com' })

    expect(findRole).toHaveBeenCalled()
    expect(created.some((c) => c.entity === UserRole)).toBe(true)
  })
})
