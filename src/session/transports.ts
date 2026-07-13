import type { NextResponse } from 'next/server'
import { ACCESS_TOKEN_TTL_SECONDS, type IssuedSession } from './issue-session.js'

export const AUTH_TOKEN_COOKIE_NAME = 'auth_token'
export const SESSION_TOKEN_COOKIE_NAME = 'session_token'
export const ACCESS_TOKEN_MAX_AGE_SECONDS = ACCESS_TOKEN_TTL_SECONDS

function isSecureEnvironment(): boolean {
  return process.env.NODE_ENV === 'production'
}

/**
 * Sets the HttpOnly `auth_token` cookie (the core JWT). Split out from
 * `setSessionCookies` so the refresh endpoint can rotate the access token
 * without touching the still-valid `session_token` refresh cookie.
 */
export function setAccessTokenCookie(res: NextResponse, token: string): void {
  res.cookies.set(AUTH_TOKEN_COOKIE_NAME, token, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: isSecureEnvironment(),
    maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS,
  })
}

/**
 * Cookie transport for same-site web clients: HttpOnly `auth_token` (the core
 * JWT, short-lived) + `session_token` (the refresh token, lives as long as
 * the session). Both are read by core `getAuthFromRequest` unchanged. Native
 * and cross-site clients ignore cookies and use the response-body tokens.
 */
export function setSessionCookies(res: NextResponse, session: IssuedSession): void {
  setAccessTokenCookie(res, session.token)
  res.cookies.set(SESSION_TOKEN_COOKIE_NAME, session.refreshToken, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: isSecureEnvironment(),
    expires: session.refreshExpiresAt,
  })
}

export function clearSessionCookies(res: NextResponse): void {
  res.cookies.set(AUTH_TOKEN_COOKIE_NAME, '', { httpOnly: true, path: '/', maxAge: 0 })
  res.cookies.set(SESSION_TOKEN_COOKIE_NAME, '', { httpOnly: true, path: '/', maxAge: 0 })
}

/** Reads a single cookie value from the request's Cookie header. */
export function readRequestCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}
