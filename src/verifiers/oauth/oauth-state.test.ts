import { decodeOauthState, encodeOauthState } from './oauth-state.js'

describe('oauth-state', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  const payload = {
    provider: 'google' as const,
    codeVerifier: 'verifier-123',
    platform: 'web' as const,
    redirect: '/app',
  }

  test('roundtrips a signed payload', () => {
    const state = encodeOauthState(payload)
    const decoded = decodeOauthState(state)
    expect(decoded).toMatchObject(payload)
    expect(decoded?.expiresAt).toBeGreaterThan(Date.now())
    expect(decoded?.nonce).toEqual(expect.any(String))
  })

  test('rejects a tampered payload', () => {
    const state = encodeOauthState(payload)
    const [data, signature] = state.split('.')
    const tamperedData = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(data, 'base64url').toString()), redirect: '/evil' }),
    ).toString('base64url')
    expect(decodeOauthState(`${tamperedData}.${signature}`)).toBeNull()
  })

  test('rejects a state signed with a different secret', () => {
    const state = encodeOauthState(payload)
    process.env.JWT_SECRET = 'other-secret'
    expect(decodeOauthState(state)).toBeNull()
  })

  test('rejects an expired state', () => {
    const state = encodeOauthState(payload)
    vi.useFakeTimers({ now: Date.now() + 11 * 60 * 1000 })
    expect(decodeOauthState(state)).toBeNull()
    vi.useRealTimers()
  })

  test('rejects malformed input', () => {
    expect(decodeOauthState(null)).toBeNull()
    expect(decodeOauthState('')).toBeNull()
    expect(decodeOauthState('no-dot')).toBeNull()
    expect(decodeOauthState('a.b')).toBeNull()
  })
})
