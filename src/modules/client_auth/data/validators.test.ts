import { loginSchema, oauthInitSchema, oauthProviderSchema, oauthTokenSchema, signupSchema } from './validators.js'

describe('client_auth validators', () => {
  test('provider schema accepts google and apple only', () => {
    expect(oauthProviderSchema.safeParse('google').success).toBe(true)
    expect(oauthProviderSchema.safeParse('apple').success).toBe(true)
    expect(oauthProviderSchema.safeParse('facebook').success).toBe(false)
  })

  test('init schema defaults platform to web', () => {
    const parsed = oauthInitSchema.parse({})
    expect(parsed.platform).toBe('web')
    expect(parsed.redirect).toBeUndefined()
  })

  test('init schema accepts mobile platform with redirect', () => {
    const parsed = oauthInitSchema.parse({ platform: 'mobile', redirect: '/app' })
    expect(parsed.platform).toBe('mobile')
  })

  test('init schema rejects unknown platform', () => {
    expect(oauthInitSchema.safeParse({ platform: 'desktop' }).success).toBe(false)
  })

  test('token schema requires a non-empty idToken', () => {
    expect(oauthTokenSchema.safeParse({ idToken: '' }).success).toBe(false)
    expect(oauthTokenSchema.safeParse({ idToken: 'abc' }).success).toBe(true)
    expect(oauthTokenSchema.safeParse({ idToken: 'abc', name: 'Jan Kowalski' }).success).toBe(true)
  })

  test('login schema normalizes the email and requires a password', () => {
    const parsed = loginSchema.parse({ email: '  Player@Example.COM ', password: 'secret' })
    expect(parsed.email).toBe('player@example.com')
    expect(loginSchema.safeParse({ email: 'player@example.com', password: '' }).success).toBe(false)
    expect(loginSchema.safeParse({ email: 'not-an-email', password: 'secret' }).success).toBe(false)
  })

  test('signup schema enforces the configured minimum password length', () => {
    const original = process.env.CLIENT_AUTH_PASSWORD_MIN_LENGTH
    process.env.CLIENT_AUTH_PASSWORD_MIN_LENGTH = '10'
    try {
      expect(signupSchema().safeParse({ email: 'p@example.com', password: 'short' }).success).toBe(false)
      expect(signupSchema().safeParse({ email: 'p@example.com', password: '0123456789' }).success).toBe(true)
    } finally {
      if (original === undefined) delete process.env.CLIENT_AUTH_PASSWORD_MIN_LENGTH
      else process.env.CLIENT_AUTH_PASSWORD_MIN_LENGTH = original
    }
  })
})
