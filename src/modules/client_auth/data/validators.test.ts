import { oauthInitSchema, oauthProviderSchema, oauthTokenSchema } from './validators.js'

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
})
