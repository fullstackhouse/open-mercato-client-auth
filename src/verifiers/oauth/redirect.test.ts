import { resolveWebRedirect } from './redirect.js'

const BASE_URL = 'https://api.example.com'

describe('resolveWebRedirect', () => {
  const originalOrigins = process.env.OAUTH_WEB_REDIRECT_ORIGINS

  afterEach(() => {
    if (originalOrigins === undefined) delete process.env.OAUTH_WEB_REDIRECT_ORIGINS
    else process.env.OAUTH_WEB_REDIRECT_ORIGINS = originalOrigins
  })

  test('keeps an absolute URL whose origin is allowlisted', () => {
    process.env.OAUTH_WEB_REDIRECT_ORIGINS = 'https://app.example.com, https://staging.example.com'
    expect(resolveWebRedirect('https://app.example.com/welcome?tab=1', BASE_URL)).toBe(
      'https://app.example.com/welcome?tab=1',
    )
    expect(resolveWebRedirect('https://staging.example.com/', BASE_URL)).toBe('https://staging.example.com/')
  })

  test('falls back to path-only sanitization for a non-allowlisted origin', () => {
    process.env.OAUTH_WEB_REDIRECT_ORIGINS = 'https://app.example.com'
    expect(resolveWebRedirect('https://evil.example.com/phish', BASE_URL)).toBe('/')
  })

  test('rejects absolute URLs entirely when the allowlist is empty', () => {
    delete process.env.OAUTH_WEB_REDIRECT_ORIGINS
    expect(resolveWebRedirect('https://app.example.com/welcome', BASE_URL)).toBe('/')
  })

  test('sanitizes relative paths regardless of the allowlist', () => {
    process.env.OAUTH_WEB_REDIRECT_ORIGINS = 'https://app.example.com'
    expect(resolveWebRedirect('/dashboard', BASE_URL)).toBe('/dashboard')
    expect(resolveWebRedirect(undefined, BASE_URL)).toBe('/')
    expect(resolveWebRedirect(null, BASE_URL)).toBe('/')
  })

  test('does not treat protocol-relative or non-http schemes as allowlisted', () => {
    process.env.OAUTH_WEB_REDIRECT_ORIGINS = 'https://app.example.com'
    expect(resolveWebRedirect('//evil.example.com/x', BASE_URL)).toBe('/')
    expect(resolveWebRedirect('javascript:alert(1)', BASE_URL)).toBe('/')
  })
})
