import type { NextResponse } from 'next/server'
import type { IssuedSession } from './issue-session.js'

export const AUTH_TOKEN_COOKIE_NAME = 'auth_token'
export const SESSION_TOKEN_COOKIE_NAME = 'session_token'
export const ACCESS_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 8

function isSecureEnvironment(): boolean {
  return process.env.NODE_ENV === 'production'
}

/**
 * Cookie transport for same-site web clients: HttpOnly `auth_token` (the core
 * JWT, short-lived) + `session_token` (the refresh token, lives as long as
 * the session). Both are read by core `getAuthFromRequest` unchanged. Native
 * and cross-site clients ignore cookies and use the response-body tokens.
 */
export function setSessionCookies(res: NextResponse, session: IssuedSession): void {
  const secure = isSecureEnvironment()
  res.cookies.set(AUTH_TOKEN_COOKIE_NAME, session.token, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure,
    maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS,
  })
  res.cookies.set(SESSION_TOKEN_COOKIE_NAME, session.refreshToken, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure,
    expires: session.expiresAt,
  })
}

export function clearSessionCookies(res: NextResponse): void {
  res.cookies.set(AUTH_TOKEN_COOKIE_NAME, '', { httpOnly: true, path: '/', maxAge: 0 })
  res.cookies.set(SESSION_TOKEN_COOKIE_NAME, '', { httpOnly: true, path: '/', maxAge: 0 })
}
