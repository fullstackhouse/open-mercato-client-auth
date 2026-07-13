import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ZodError } from 'zod'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isSignupEnabled } from '../../../config.js'
import { buildAccessToken, accessTokenExpiry, issueSession } from '../../../session/issue-session.js'
import {
  SESSION_TOKEN_COOKIE_NAME,
  clearSessionCookies,
  readRequestCookie,
  setAccessTokenCookie,
  setSessionCookies,
} from '../../../session/transports.js'
import { toUserView } from '../../../session/user-view.js'
import { createCoreAuthUserStore } from '../../../stores/core-auth.js'
import { emitClientAuthEvent } from '../events.js'
import {
  loginSchema,
  logoutSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  refreshSchema,
  signupSchema,
} from '../data/validators.js'

type Translate = (key: string, fallback: string) => string

async function resolveEm(): Promise<EntityManager> {
  const container = await createRequestContainer()
  return container.resolve('em') as EntityManager
}

async function readJson(req: Request): Promise<unknown> {
  return req.json().catch(() => ({}))
}

function invalidPayload(translate: Translate, error: ZodError): NextResponse {
  return NextResponse.json(
    { error: translate('client_auth.errors.invalidPayload', 'Invalid payload'), issues: error.issues },
    { status: 400 },
  )
}

// POST /api/client_auth/login — { email, password } → session (cookies + body).
export async function handleLogin(req: Request): Promise<Response> {
  const { translate } = await resolveTranslations()
  const parsed = loginSchema.safeParse(await readJson(req))
  if (!parsed.success) return invalidPayload(translate, parsed.error)

  const em = await resolveEm()
  const store = createCoreAuthUserStore(em)
  const user = await store.verifyCredentials(parsed.data.email, parsed.data.password)
  if (!user) {
    return NextResponse.json(
      { error: translate('client_auth.errors.invalidCredentials', 'Incorrect email or password.') },
      { status: 401 },
    )
  }

  const session = await issueSession(em, user)
  const res = NextResponse.json({
    ok: true,
    token: session.token,
    refreshToken: session.refreshToken,
    expiresAt: session.accessExpiresAt.toISOString(),
    user: await toUserView(em, user),
  })
  setSessionCookies(res, session)
  return res
}

// GET /api/client_auth/session — whoami. Cookie (web) or bearer (native).
export async function handleSession(req: Request): Promise<Response> {
  const auth = await getAuthFromRequest(req)
  if (!auth || typeof auth.sub !== 'string' || auth.isApiKey) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const em = await resolveEm()
  const user = await findOneWithDecryption(
    em,
    User,
    { id: auth.sub, deletedAt: null },
    undefined,
    { tenantId: auth.tenantId, organizationId: auth.orgId },
  )
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const exp = typeof auth.exp === 'number' ? auth.exp : null
  return NextResponse.json({
    user: {
      id: String(user.id),
      email: user.email ?? auth.email ?? null,
      name: user.name ?? null,
      roles: auth.roles ?? [],
      tenantId: auth.tenantId,
      orgId: auth.orgId,
    },
    expiresAt: exp ? new Date(exp * 1000).toISOString() : null,
  })
}

// POST /api/client_auth/refresh — session_token cookie or { refreshToken } →
// a fresh access JWT against the same session (no new refresh token minted).
export async function handleRefresh(req: Request): Promise<Response> {
  const { translate } = await resolveTranslations()
  const parsed = refreshSchema.safeParse(await readJson(req))
  const refreshToken =
    (parsed.success ? parsed.data.refreshToken : undefined) ?? readRequestCookie(req, SESSION_TOKEN_COOKIE_NAME)

  const unauthorized = () => {
    const res = NextResponse.json(
      { error: translate('client_auth.errors.sessionExpired', 'Your session has expired. Please sign in again.') },
      { status: 401 },
    )
    clearSessionCookies(res)
    return res
  }

  if (!refreshToken) return unauthorized()

  const em = await resolveEm()
  const result = await new AuthService(em).refreshFromSessionToken(refreshToken)
  if (!result) return unauthorized()

  const token = buildAccessToken(result.user, String(result.session.id), result.roles)
  const res = NextResponse.json({
    ok: true,
    token,
    expiresAt: accessTokenExpiry().toISOString(),
    user: await toUserView(em, result.user, result.roles),
  })
  setAccessTokenCookie(res, token)
  return res
}

// POST /api/client_auth/logout — revoke the session row, clear cookies.
export async function handleLogout(req: Request): Promise<Response> {
  const parsed = logoutSchema.safeParse(await readJson(req))
  const refreshToken =
    (parsed.success ? parsed.data.refreshToken : undefined) ?? readRequestCookie(req, SESSION_TOKEN_COOKIE_NAME)

  if (refreshToken) {
    const em = await resolveEm()
    await new AuthService(em).deleteSessionByToken(refreshToken)
  }

  const res = NextResponse.json({ ok: true })
  clearSessionCookies(res)
  return res
}

// POST /api/client_auth/signup — public registration → new user + session.
export async function handleSignup(req: Request): Promise<Response> {
  const { translate } = await resolveTranslations()
  if (!isSignupEnabled()) {
    return NextResponse.json(
      { error: translate('client_auth.errors.signupDisabled', 'Sign-up is not available.') },
      { status: 403 },
    )
  }

  const parsed = signupSchema().safeParse(await readJson(req))
  if (!parsed.success) return invalidPayload(translate, parsed.error)

  const em = await resolveEm()
  const store = createCoreAuthUserStore(em)
  const result = await store.createUser(parsed.data)
  if (result.kind === 'error') {
    if (result.reason === 'email-taken') {
      return NextResponse.json(
        { error: translate('client_auth.errors.emailTaken', 'An account with this email already exists.') },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { error: translate('client_auth.errors.signupUnavailable', 'Sign-up is temporarily unavailable.') },
      { status: 503 },
    )
  }

  const session = await issueSession(em, result.user)
  const res = NextResponse.json(
    {
      ok: true,
      token: session.token,
      refreshToken: session.refreshToken,
      expiresAt: session.accessExpiresAt.toISOString(),
      user: await toUserView(em, result.user),
    },
    { status: 201 },
  )
  setSessionCookies(res, session)
  return res
}

// POST /api/client_auth/password-reset/request — always responds ok
// (anti-enumeration); emits an event carrying the reset token so the host
// sends the email (with its own template + frontend URL).
export async function handlePasswordResetRequest(req: Request): Promise<Response> {
  const { translate } = await resolveTranslations()
  const parsed = passwordResetRequestSchema.safeParse(await readJson(req))
  if (!parsed.success) return invalidPayload(translate, parsed.error)

  const em = await resolveEm()
  const result = await new AuthService(em).requestPasswordReset(parsed.data.email)
  if (result) {
    await emitClientAuthEvent('client_auth.password_reset.requested', {
      userId: String(result.user.id),
      email: parsed.data.email,
      token: result.token,
      redirectTo: parsed.data.redirectTo ?? null,
      tenantId: result.user.tenantId ? String(result.user.tenantId) : null,
    })
  }
  return NextResponse.json({ ok: true })
}

// POST /api/client_auth/password-reset/confirm — { token, newPassword }.
// Core revokes all of the user's sessions on success.
export async function handlePasswordResetConfirm(req: Request): Promise<Response> {
  const { translate } = await resolveTranslations()
  const parsed = passwordResetConfirmSchema().safeParse(await readJson(req))
  if (!parsed.success) return invalidPayload(translate, parsed.error)

  const em = await resolveEm()
  const user = await new AuthService(em).confirmPasswordReset(parsed.data.token, parsed.data.newPassword)
  if (!user) {
    return NextResponse.json(
      {
        error: translate(
          'client_auth.errors.invalidResetToken',
          'This password reset link is invalid or has expired.',
        ),
      },
      { status: 400 },
    )
  }
  return NextResponse.json({ ok: true })
}
