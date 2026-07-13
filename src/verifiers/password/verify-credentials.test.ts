import type { EntityManager } from '@mikro-orm/postgresql'
import { verifyCredentials } from './verify-credentials.js'

const { mockFindUserByEmail, mockVerifyPassword } = vi.hoisted(() => ({
  mockFindUserByEmail: vi.fn(),
  mockVerifyPassword: vi.fn(),
}))

vi.mock('@open-mercato/core/modules/auth/services/authService', () => ({
  AuthService: vi.fn().mockImplementation(() => ({
    findUserByEmail: mockFindUserByEmail,
    verifyPassword: mockVerifyPassword,
  })),
}))

const em = {} as unknown as EntityManager

describe('verifyCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns the user when the password matches', async () => {
    const user = { id: 'user-1', email: 'player@example.com' }
    mockFindUserByEmail.mockResolvedValue(user)
    mockVerifyPassword.mockResolvedValue(true)

    await expect(verifyCredentials(em, 'player@example.com', 'secret')).resolves.toBe(user)
    expect(mockVerifyPassword).toHaveBeenCalledWith(user, 'secret')
  })

  test('returns null when the password is wrong', async () => {
    const user = { id: 'user-1' }
    mockFindUserByEmail.mockResolvedValue(user)
    mockVerifyPassword.mockResolvedValue(false)

    await expect(verifyCredentials(em, 'player@example.com', 'nope')).resolves.toBeNull()
  })

  test('still runs the password comparison for an unknown email (timing equalization)', async () => {
    mockFindUserByEmail.mockResolvedValue(null)
    mockVerifyPassword.mockResolvedValue(false)

    await expect(verifyCredentials(em, 'ghost@example.com', 'secret')).resolves.toBeNull()
    expect(mockVerifyPassword).toHaveBeenCalledWith(null, 'secret')
  })
})
