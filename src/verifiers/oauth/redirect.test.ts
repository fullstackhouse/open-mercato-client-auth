import { isRefusedWebRedirect, resolveWebRedirect } from './redirect.js'

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

  test('admits one host label where an entry carries a wildcard', () => {
    process.env.OAUTH_WEB_REDIRECT_ORIGINS = 'https://app.example.com, https://*.app.example.com'
    expect(resolveWebRedirect('https://tenant.app.example.com/welcome', BASE_URL)).toBe(
      'https://tenant.app.example.com/welcome',
    )
    expect(resolveWebRedirect('https://deeper.tenant.app.example.com/welcome', BASE_URL)).toBe('/')
    expect(resolveWebRedirect('https://app.example.com.evil.com/welcome', BASE_URL)).toBe('/')
  })

  test('several wildcards in one entry each stand for their own run', () => {
    process.env.OAUTH_WEB_REDIRECT_ORIGINS = 'https://*-pr-*.app.example.com'
    expect(resolveWebRedirect('https://tenant-pr-12.app.example.com/welcome', BASE_URL)).toBe(
      'https://tenant-pr-12.app.example.com/welcome',
    )
    expect(resolveWebRedirect('https://tenant-pr-12.deeper.app.example.com/welcome', BASE_URL)).toBe('/')
  })

  test('a wildcard entry does not admit another scheme or port', () => {
    process.env.OAUTH_WEB_REDIRECT_ORIGINS = 'https://*.app.example.com'
    expect(resolveWebRedirect('http://tenant.app.example.com/welcome', BASE_URL)).toBe('/')
    expect(resolveWebRedirect('https://tenant.app.example.com:8443/welcome', BASE_URL)).toBe('/')
  })
})

describe('isRefusedWebRedirect', () => {
  const originalOrigins = process.env.OAUTH_WEB_REDIRECT_ORIGINS

  afterEach(() => {
    if (originalOrigins === undefined) delete process.env.OAUTH_WEB_REDIRECT_ORIGINS
    else process.env.OAUTH_WEB_REDIRECT_ORIGINS = originalOrigins
  })

  test('refuses an absolute URL the allowlist does not admit', () => {
    process.env.OAUTH_WEB_REDIRECT_ORIGINS = 'https://app.example.com'
    expect(isRefusedWebRedirect('https://evil.example.com/phish', BASE_URL)).toBe(true)
    expect(isRefusedWebRedirect('https://app.example.com/welcome', BASE_URL)).toBe(false)
  })

  test('never refuses a URL this app itself serves', () => {
    delete process.env.OAUTH_WEB_REDIRECT_ORIGINS
    expect(isRefusedWebRedirect(`${BASE_URL}/backend`, BASE_URL)).toBe(false)
    expect(resolveWebRedirect(`${BASE_URL}/backend`, BASE_URL)).toBe('/backend')
  })

  test('leaves same-app redirects to path sanitization', () => {
    process.env.OAUTH_WEB_REDIRECT_ORIGINS = 'https://app.example.com'
    expect(isRefusedWebRedirect('/dashboard', BASE_URL)).toBe(false)
    expect(isRefusedWebRedirect('//evil.example.com/x', BASE_URL)).toBe(false)
    expect(isRefusedWebRedirect(undefined, BASE_URL)).toBe(false)
    expect(isRefusedWebRedirect(null, BASE_URL)).toBe(false)
  })
})
