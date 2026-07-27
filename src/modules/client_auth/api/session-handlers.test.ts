import { handleRefresh } from './session-handlers.js'

const { mockRefreshFromSessionToken, mockToUserView } = vi.hoisted(() => ({
  mockRefreshFromSessionToken: vi.fn(),
  mockToUserView: vi.fn(),
}))

vi.mock('@open-mercato/core/modules/auth/services/authService', () => ({
  AuthService: vi.fn().mockImplementation(() => ({
    refreshFromSessionToken: mockRefreshFromSessionToken,
  })),
}))

vi.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: () => ({}) }),
}))

vi.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

vi.mock('../../../session/user-view.js', () => ({
  toUserView: (...args: unknown[]) => mockToUserView(...args),
}))

function refreshRequest(cookie?: string): Request {
  return new Request('https://example.test/api/client_auth/refresh', {
    method: 'POST',
    headers: cookie ? { cookie } : {},
    body: '{}',
  })
}

/** Names of the cookies a response asks the browser to delete (Max-Age=0). */
function clearedCookies(res: Response): string[] {
  return res.headers
    .getSetCookie()
    .filter((c) => /(?:^|;\s*)max-age=0(?:;|$)/i.test(c))
    .map((c) => c.split('=')[0])
}

describe('handleRefresh', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    vi.clearAllMocks()
  })

  // Regression: clearing cookies here is destructive. Clients probe this
  // endpoint speculatively on page load to restore a session whose short-lived
  // access token expired; for an anonymous visitor that probe carries no token
  // and its 401 can land AFTER a login that happened while it was in flight,
  // wiping a valid, newer session. Nothing was presented, so nothing to clear.
  test('does not clear cookies when no refresh token was presented', async () => {
    const res = await handleRefresh(refreshRequest())

    expect(res.status).toBe(401)
    expect(clearedCookies(res)).toEqual([])
    expect(mockRefreshFromSessionToken).not.toHaveBeenCalled()
  })

  test('clears cookies when the presented refresh token is invalid', async () => {
    mockRefreshFromSessionToken.mockResolvedValue(null)

    const res = await handleRefresh(refreshRequest('session_token=stale-token'))

    expect(res.status).toBe(401)
    expect(clearedCookies(res).sort()).toEqual(['auth_token', 'session_token'])
    expect(mockRefreshFromSessionToken).toHaveBeenCalledWith('stale-token')
  })

  test('re-issues the access token when the presented refresh token is valid', async () => {
    mockRefreshFromSessionToken.mockResolvedValue({
      user: { id: 'user-1', email: 'a@example.test', tenantId: 'tenant-1', organizationId: null },
      session: { id: 'session-1' },
      roles: ['admin'],
    })
    mockToUserView.mockResolvedValue({ id: 'user-1', email: 'a@example.test' })

    const res = await handleRefresh(refreshRequest('session_token=good-token'))

    expect(res.status).toBe(200)
    expect(clearedCookies(res)).toEqual([])
    expect(res.headers.getSetCookie().some((c) => c.startsWith('auth_token='))).toBe(true)
  })
})
