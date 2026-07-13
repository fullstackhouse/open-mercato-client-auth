import { generateAppleClientSecret } from './verifiers/oauth/apple-client-secret.js'

export const OAUTH_PROVIDERS = ['google', 'apple'] as const
export type OauthProvider = (typeof OAUTH_PROVIDERS)[number]

export type OauthProviderConfig = {
  clientId: string
  clientSecret: string
  authorizationEndpoint: string
  tokenEndpoint: string
  jwksUrl: string
  issuers: string[]
  scope: string
  extraAuthParams?: Record<string, string>
}

export const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
export const APPLE_AUTHORIZATION_ENDPOINT = 'https://appleid.apple.com/auth/authorize'
export const APPLE_TOKEN_ENDPOINT = 'https://appleid.apple.com/auth/token'
export const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys'

export const DEFAULT_MOBILE_REDIRECT_URI = 'tourneeapp://auth/callback'

export function getMobileRedirectUri(): string {
  return process.env.OAUTH_MOBILE_REDIRECT_URI || DEFAULT_MOBILE_REDIRECT_URI
}

/**
 * Comma-separated list of origins (OAUTH_WEB_REDIRECT_ORIGINS) that web OAuth
 * flows may redirect to after sign-in, in addition to same-app paths. Empty
 * (the default) means only path-only redirects on the app's own origin.
 */
export function getWebRedirectOrigins(): string[] {
  return (process.env.OAUTH_WEB_REDIRECT_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

export const DEFAULT_SESSION_DAYS = 30

export function getSessionDays(): number {
  const rawDays = Number(process.env.REFRESH_TOKEN_DAYS)
  return Number.isFinite(rawDays) && rawDays > 0 ? rawDays : DEFAULT_SESSION_DAYS
}

export async function getProviderConfig(provider: OauthProvider): Promise<OauthProviderConfig | null> {
  if (provider === 'google') {
    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    if (!clientId || !clientSecret) return null
    return {
      clientId,
      clientSecret,
      authorizationEndpoint: GOOGLE_AUTHORIZATION_ENDPOINT,
      tokenEndpoint: GOOGLE_TOKEN_ENDPOINT,
      jwksUrl: GOOGLE_JWKS_URL,
      issuers: ['https://accounts.google.com', 'accounts.google.com'],
      scope: 'openid email profile',
      extraAuthParams: { access_type: 'offline', prompt: 'select_account' },
    }
  }

  const clientId = process.env.APPLE_CLIENT_ID
  if (!clientId) return null
  const clientSecret = await generateAppleClientSecret()
  if (!clientSecret) return null
  return {
    clientId,
    clientSecret,
    authorizationEndpoint: APPLE_AUTHORIZATION_ENDPOINT,
    tokenEndpoint: APPLE_TOKEN_ENDPOINT,
    jwksUrl: APPLE_JWKS_URL,
    issuers: ['https://appleid.apple.com'],
    scope: 'name email',
    extraAuthParams: { response_mode: 'form_post' },
  }
}
