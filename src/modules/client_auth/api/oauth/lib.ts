import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { getAppBaseUrl } from '@open-mercato/shared/lib/url'
import type { OauthProvider } from '../../../../config.js'
import { getMobileRedirectUri, getProviderConfig } from '../../../../config.js'
import { issueSession } from '../../../../session/issue-session.js'
import { setSessionCookies } from '../../../../session/transports.js'
import { createCoreAuthUserStore } from '../../../../stores/core-auth.js'
import type { FindOrCreateOauthUserResult } from '../../../../verifiers/oauth/find-or-create-oauth-user.js'
import { decodeOauthState, encodeOauthState, type OauthStatePayload } from '../../../../verifiers/oauth/oauth-state.js'
import { generatePkcePair } from '../../../../verifiers/oauth/pkce.js'
import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  verifyIdToken,
  type OauthIdentity,
} from '../../../../verifiers/oauth/providers.js'
import { resolveWebRedirect } from '../../../../verifiers/oauth/redirect.js'
import { oauthInitSchema, oauthTokenSchema } from '../../data/validators.js'

export const STATE_COOKIE_NAME = 'client_auth_oauth_state'

type Translate = (key: string, fallback: string) => string

function callbackUri(req: Request, provider: OauthProvider): string {
  return `${getAppBaseUrl(req)}/api/client_auth/oauth/${provider}/callback`
}

function providerNotConfigured(translate: Translate): NextResponse {
  return NextResponse.json(
    { error: translate('client_auth.errors.providerNotConfigured', 'This sign-in provider is not available.') },
    { status: 400 },
  )
}

export async function handleOauthInit(provider: OauthProvider, req: Request): Promise<Response> {
  const { translate } = await resolveTranslations()
  const body = await req.json().catch(() => ({}))
  const parsed = oauthInitSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json(
      { error: translate('client_auth.errors.invalidPayload', 'Invalid payload'), issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const config = await getProviderConfig(provider)
  if (!config) return providerNotConfigured(translate)

  const { platform, redirect } = parsed.data
  const sanitizedRedirect = platform === 'web' ? resolveWebRedirect(redirect, getAppBaseUrl(req)) : null

  const pkce = generatePkcePair()
  const state = encodeOauthState({
    provider,
    codeVerifier: pkce.codeVerifier,
    platform,
    redirect: sanitizedRedirect,
  })

  const url = buildAuthorizationUrl({
    config,
    redirectUri: callbackUri(req, provider),
    state,
    codeChallenge: pkce.codeChallenge,
  })

  const res = NextResponse.json({ ok: true, url, state })
  res.cookies.set(STATE_COOKIE_NAME, state, {
    httpOnly: true,
    path: '/',
    sameSite: provider === 'apple' ? 'none' : 'lax',
    secure: provider === 'apple' || process.env.NODE_ENV === 'production',
    maxAge: 600,
  })
  return res
}

type CallbackParams = {
  code: string | null
  state: string | null
  error: string | null
  appleUser: string | null
}

async function parseCallbackParams(req: Request): Promise<CallbackParams> {
  if (req.method === 'POST') {
    const form = await req.formData().catch(() => null)
    return {
      code: (form?.get('code') as string | null) ?? null,
      state: (form?.get('state') as string | null) ?? null,
      error: (form?.get('error') as string | null) ?? null,
      appleUser: (form?.get('user') as string | null) ?? null,
    }
  }
  const url = new URL(req.url)
  return {
    code: url.searchParams.get('code'),
    state: url.searchParams.get('state'),
    error: url.searchParams.get('error'),
    appleUser: url.searchParams.get('user'),
  }
}

function parseAppleUserName(appleUser: string | null): string | null {
  if (!appleUser) return null
  try {
    const parsed = JSON.parse(appleUser) as { name?: { firstName?: string; lastName?: string } }
    const name = [parsed.name?.firstName, parsed.name?.lastName].filter(Boolean).join(' ').trim()
    return name || null
  } catch {
    return null
  }
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

function failureRedirect(req: Request, statePayload: OauthStatePayload | null, reason: string): NextResponse {
  if (statePayload?.platform === 'mobile') {
    const target = new URL(getMobileRedirectUri())
    target.searchParams.set('error', reason)
    return NextResponse.redirect(target.toString(), 302)
  }
  const target = new URL('/auth-error', getAppBaseUrl(req))
  target.searchParams.set('error', reason)
  return NextResponse.redirect(target.toString(), 302)
}

function signUpFailureReason(result: Extract<FindOrCreateOauthUserResult, { kind: 'error' }>): string {
  return `oauth_${result.reason.replace(/-/g, '_')}`
}

export async function handleOauthCallback(provider: OauthProvider, req: Request): Promise<Response> {
  const params = await parseCallbackParams(req)
  const statePayload = decodeOauthState(params.state)

  if (params.error) {
    return failureRedirect(req, statePayload, params.error)
  }
  if (!statePayload || statePayload.provider !== provider || !params.code) {
    return failureRedirect(req, statePayload, 'oauth_invalid_state')
  }

  const cookieState = readCookie(req, STATE_COOKIE_NAME)
  if (cookieState && cookieState !== params.state) {
    return failureRedirect(req, statePayload, 'oauth_invalid_state')
  }

  const config = await getProviderConfig(provider)
  if (!config) {
    return failureRedirect(req, statePayload, 'oauth_provider_not_configured')
  }

  let identity: OauthIdentity
  let tokens
  try {
    tokens = await exchangeAuthorizationCode({
      config,
      code: params.code,
      codeVerifier: statePayload.codeVerifier,
      redirectUri: callbackUri(req, provider),
    })
    if (!tokens.idToken) {
      return failureRedirect(req, statePayload, 'oauth_missing_id_token')
    }
    identity = await verifyIdToken({
      provider,
      config,
      idToken: tokens.idToken,
      fallbackName: parseAppleUserName(params.appleUser),
    })
  } catch (error) {
    console.error(`[client_auth] ${provider} callback failed:`, {
      message: error instanceof Error ? error.message : String(error),
    })
    return failureRedirect(req, statePayload, 'oauth_exchange_failed')
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const store = createCoreAuthUserStore(em)
  const result = await store.findOrCreateFromOauth({ identity, tokens })
  if (result.kind === 'error') {
    return failureRedirect(req, statePayload, signUpFailureReason(result))
  }

  const session = await issueSession(em, result.user)

  if (statePayload.platform === 'mobile') {
    const target = new URL(getMobileRedirectUri())
    target.searchParams.set('token', session.token)
    target.searchParams.set('refreshToken', session.refreshToken)
    target.searchParams.set('isNewUser', String(result.isNewUser))
    return NextResponse.redirect(target.toString(), 302)
  }

  const baseUrl = getAppBaseUrl(req)
  const target = new URL(resolveWebRedirect(statePayload.redirect, baseUrl), baseUrl)
  target.searchParams.set('isNewUser', String(result.isNewUser))
  const res = NextResponse.redirect(target.toString(), 302)
  setSessionCookies(res, session)
  res.cookies.set(STATE_COOKIE_NAME, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}

export async function handleOauthToken(provider: OauthProvider, req: Request): Promise<Response> {
  const { translate } = await resolveTranslations()
  const body = await req.json().catch(() => ({}))
  const parsed = oauthTokenSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json(
      { error: translate('client_auth.errors.invalidPayload', 'Invalid payload'), issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const config = await getProviderConfig(provider)
  if (!config) return providerNotConfigured(translate)

  let identity: OauthIdentity
  try {
    identity = await verifyIdToken({
      provider,
      config,
      idToken: parsed.data.idToken,
      fallbackName: parsed.data.name ?? null,
    })
  } catch {
    return NextResponse.json(
      { error: translate('client_auth.errors.invalidToken', 'Invalid or expired token.') },
      { status: 401 },
    )
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const store = createCoreAuthUserStore(em)
  const result = await store.findOrCreateFromOauth({ identity, tokens: null })
  if (result.kind === 'error') {
    return NextResponse.json(
      { error: translate('client_auth.errors.signInFailed', 'Sign-in failed. Please try again.'), reason: signUpFailureReason(result) },
      { status: 401 },
    )
  }

  const session = await issueSession(em, result.user)
  return NextResponse.json({
    ok: true,
    token: session.token,
    refreshToken: session.refreshToken,
    isNewUser: result.isNewUser,
    user: {
      id: String(result.user.id),
      email: result.user.email,
      name: result.user.name ?? null,
    },
  })
}
