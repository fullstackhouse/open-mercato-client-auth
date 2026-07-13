import crypto from 'node:crypto'
import { SignJWT, exportJWK } from 'jose'
import type { OauthProviderConfig } from '../../config.js'
import { buildAuthorizationUrl, exchangeAuthorizationCode, verifyIdToken } from './providers.js'

const baseConfig: OauthProviderConfig = {
  clientId: 'client-123',
  clientSecret: 'secret-456',
  authorizationEndpoint: 'https://provider.example/authorize',
  tokenEndpoint: 'https://provider.example/token',
  jwksUrl: 'https://provider.example/jwks',
  issuers: ['https://provider.example'],
  scope: 'openid email profile',
  extraAuthParams: { access_type: 'offline' },
}

describe('buildAuthorizationUrl', () => {
  test('includes client, redirect, PKCE challenge, state and extra params', () => {
    const url = new URL(
      buildAuthorizationUrl({
        config: baseConfig,
        redirectUri: 'https://api.example/api/client_auth/oauth/google/callback',
        state: 'state-xyz',
        codeChallenge: 'challenge-abc',
      }),
    )
    expect(url.origin + url.pathname).toBe('https://provider.example/authorize')
    expect(url.searchParams.get('client_id')).toBe('client-123')
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.example/api/client_auth/oauth/google/callback')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe('openid email profile')
    expect(url.searchParams.get('state')).toBe('state-xyz')
    expect(url.searchParams.get('code_challenge')).toBe('challenge-abc')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('access_type')).toBe('offline')
  })
})

describe('exchangeAuthorizationCode', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  test('posts the code with PKCE verifier and maps the response', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: 'at-1',
          refresh_token: 'rt-1',
          expires_in: 3600,
          scope: 'openid email',
          id_token: 'idt-1',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    global.fetch = fetchMock as unknown as typeof fetch

    const tokens = await exchangeAuthorizationCode({
      config: baseConfig,
      code: 'auth-code',
      codeVerifier: 'verifier-1',
      redirectUri: 'https://api.example/cb',
    })

    expect(tokens).toEqual({
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      expiresIn: 3600,
      scope: 'openid email',
      idToken: 'idt-1',
    })

    const [endpoint, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(endpoint).toBe('https://provider.example/token')
    const body = new URLSearchParams(String(init.body))
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('auth-code')
    expect(body.get('code_verifier')).toBe('verifier-1')
    expect(body.get('client_id')).toBe('client-123')
    expect(body.get('client_secret')).toBe('secret-456')
    expect(body.get('redirect_uri')).toBe('https://api.example/cb')
  })

  test('throws on a non-2xx token response', async () => {
    global.fetch = vi.fn(async () =>
      new Response('{"error":"invalid_grant"}', { status: 400 }),
    ) as unknown as typeof fetch

    await expect(
      exchangeAuthorizationCode({
        config: baseConfig,
        code: 'bad-code',
        codeVerifier: 'v',
        redirectUri: 'https://api.example/cb',
      }),
    ).rejects.toThrow('Token exchange failed (400)')
  })
})

describe('verifyIdToken', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  async function setupSigner(_jwksUrl: string) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const jwk = await exportJWK(publicKey)
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'kid-1', alg: 'ES256', use: 'sig' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch
    return {
      sign: (claims: Record<string, unknown>, opts?: { issuer?: string; audience?: string }) =>
        new SignJWT(claims)
          .setProtectedHeader({ alg: 'ES256', kid: 'kid-1' })
          .setIssuer(opts?.issuer ?? 'https://provider.example')
          .setAudience(opts?.audience ?? 'client-123')
          .setSubject(String(claims.sub ?? 'subject-1'))
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(privateKey),
    }
  }

  test('verifies a valid identity token and extracts the identity', async () => {
    const config = { ...baseConfig, jwksUrl: 'https://provider.example/jwks-valid' }
    const signer = await setupSigner(config.jwksUrl)
    const idToken = await signer.sign({
      sub: 'google-user-1',
      email: 'Player@Example.com',
      email_verified: true,
      name: 'Player One',
    })

    const identity = await verifyIdToken({ provider: 'google', config, idToken })
    expect(identity).toEqual({
      provider: 'google',
      providerUserId: 'google-user-1',
      email: 'player@example.com',
      emailVerified: true,
      name: 'Player One',
    })
  })

  test('uses the fallback name when the token has none (Apple)', async () => {
    const config = { ...baseConfig, jwksUrl: 'https://provider.example/jwks-fallback' }
    const signer = await setupSigner(config.jwksUrl)
    const idToken = await signer.sign({
      sub: 'apple-user-1',
      email: 'relay@privaterelay.appleid.com',
      email_verified: 'true',
    })

    const identity = await verifyIdToken({
      provider: 'apple',
      config,
      idToken,
      fallbackName: 'Jan Kowalski',
    })
    expect(identity.name).toBe('Jan Kowalski')
    expect(identity.emailVerified).toBe(true)
  })

  test('rejects a token issued for another audience', async () => {
    const config = { ...baseConfig, jwksUrl: 'https://provider.example/jwks-aud' }
    const signer = await setupSigner(config.jwksUrl)
    const idToken = await signer.sign({ sub: 'user-1' }, { audience: 'other-client' })

    await expect(verifyIdToken({ provider: 'google', config, idToken })).rejects.toThrow()
  })

  test('rejects a token from an untrusted issuer', async () => {
    const config = { ...baseConfig, jwksUrl: 'https://provider.example/jwks-iss' }
    const signer = await setupSigner(config.jwksUrl)
    const idToken = await signer.sign({ sub: 'user-1' }, { issuer: 'https://evil.example' })

    await expect(verifyIdToken({ provider: 'google', config, idToken })).rejects.toThrow()
  })
})
