import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import type { OauthProvider, OauthProviderConfig } from '../../config.js'

export type OauthIdentity = {
  provider: OauthProvider
  providerUserId: string
  email: string | null
  emailVerified: boolean
  name: string | null
}

export type OauthTokenResponse = {
  accessToken: string | null
  refreshToken: string | null
  expiresIn: number | null
  scope: string | null
  idToken: string | null
}

export function buildAuthorizationUrl(params: {
  config: OauthProviderConfig
  redirectUri: string
  state: string
  codeChallenge: string
}): string {
  const { config, redirectUri, state, codeChallenge } = params
  const url = new URL(config.authorizationEndpoint)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', config.scope)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  for (const [key, value] of Object.entries(config.extraAuthParams ?? {})) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

export async function exchangeAuthorizationCode(params: {
  config: OauthProviderConfig
  code: string
  codeVerifier: string
  redirectUri: string
}): Promise<OauthTokenResponse> {
  const { config, code, codeVerifier, redirectUri } = params
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code_verifier: codeVerifier,
  })

  const response = await fetch(config.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Token exchange failed (${response.status}): ${detail.slice(0, 500)}`)
  }

  const json = (await response.json()) as Record<string, unknown>
  return {
    accessToken: typeof json.access_token === 'string' ? json.access_token : null,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
    expiresIn: typeof json.expires_in === 'number' ? json.expires_in : null,
    scope: typeof json.scope === 'string' ? json.scope : null,
    idToken: typeof json.id_token === 'string' ? json.id_token : null,
  }
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function getJwks(jwksUrl: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksCache.get(jwksUrl)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUrl))
    jwksCache.set(jwksUrl, jwks)
  }
  return jwks
}

export async function verifyIdToken(params: {
  provider: OauthProvider
  config: OauthProviderConfig
  idToken: string
  fallbackName?: string | null
}): Promise<OauthIdentity> {
  const { provider, config, idToken, fallbackName } = params
  const { payload } = await jwtVerify(idToken, getJwks(config.jwksUrl), {
    issuer: config.issuers,
    audience: config.clientId,
  })
  return toIdentity(provider, payload, fallbackName ?? null)
}

function toIdentity(provider: OauthProvider, payload: JWTPayload, fallbackName: string | null): OauthIdentity {
  if (!payload.sub) throw new Error('Identity token has no subject')
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null
  const emailVerified = payload.email_verified === true || payload.email_verified === 'true'
  const name = typeof payload.name === 'string' && payload.name ? payload.name : fallbackName
  return { provider, providerUserId: payload.sub, email, emailVerified, name }
}
