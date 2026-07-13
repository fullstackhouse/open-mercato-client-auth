import crypto from 'node:crypto'
import { decodeProtectedHeader, decodeJwt } from 'jose'
import { generateAppleClientSecret } from './apple-client-secret.js'

const APPLE_ENV_KEYS = [
  'APPLE_CLIENT_SECRET',
  'APPLE_TEAM_ID',
  'APPLE_KEY_ID',
  'APPLE_CLIENT_ID',
  'APPLE_PRIVATE_KEY',
] as const

describe('generateAppleClientSecret', () => {
  const originalEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of APPLE_ENV_KEYS) {
      originalEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of APPLE_ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key]
      else process.env[key] = originalEnv[key]
    }
  })

  test('returns the static APPLE_CLIENT_SECRET when set', async () => {
    process.env.APPLE_CLIENT_SECRET = 'pre-generated-jwt'
    process.env.APPLE_TEAM_ID = 'TEAM'
    await expect(generateAppleClientSecret()).resolves.toBe('pre-generated-jwt')
  })

  test('returns empty string when signing config is incomplete', async () => {
    process.env.APPLE_TEAM_ID = 'TEAM'
    process.env.APPLE_KEY_ID = 'KEY'
    await expect(generateAppleClientSecret()).resolves.toBe('')
  })

  test('signs an ES256 JWT from the private key', async () => {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    process.env.APPLE_TEAM_ID = 'TEAM123'
    process.env.APPLE_KEY_ID = 'KEYID456'
    process.env.APPLE_CLIENT_ID = 'io.example.app'
    process.env.APPLE_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

    const secret = await generateAppleClientSecret()
    expect(secret).not.toBe('')

    const header = decodeProtectedHeader(secret)
    expect(header).toMatchObject({ alg: 'ES256', kid: 'KEYID456' })

    const claims = decodeJwt(secret)
    expect(claims).toMatchObject({
      iss: 'TEAM123',
      sub: 'io.example.app',
      aud: 'https://appleid.apple.com',
    })
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(180 * 24 * 60 * 60)
  })

  test('returns empty string for an invalid private key', async () => {
    process.env.APPLE_TEAM_ID = 'TEAM123'
    process.env.APPLE_KEY_ID = 'KEYID456'
    process.env.APPLE_CLIENT_ID = 'io.example.app'
    process.env.APPLE_PRIVATE_KEY = 'not-a-key'
    await expect(generateAppleClientSecret()).resolves.toBe('')
  })
})
