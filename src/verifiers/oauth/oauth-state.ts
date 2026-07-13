import crypto from 'node:crypto'
import type { OauthProvider } from '../../config.js'

export type OauthStatePayload = {
  provider: OauthProvider
  codeVerifier: string
  platform: 'web' | 'mobile'
  redirect: string | null
  expiresAt: number
  nonce: string
}

const STATE_TTL_MS = 10 * 60 * 1000

function getStateSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is not set')
  return `${secret}:client_auth:oauth-state:v1`
}

function sign(data: string): string {
  return crypto.createHmac('sha256', getStateSecret()).update(data).digest('base64url')
}

/**
 * The OAuth `state` parameter is a self-contained, HMAC-signed payload: the
 * server stays stateless (no state table) and the callback can run without a
 * cookie, which mobile system-browser flows require. A short TTL bounds replay.
 */
export function encodeOauthState(payload: Omit<OauthStatePayload, 'expiresAt' | 'nonce'>): string {
  const full: OauthStatePayload = {
    ...payload,
    expiresAt: Date.now() + STATE_TTL_MS,
    nonce: crypto.randomBytes(16).toString('base64url'),
  }
  const data = Buffer.from(JSON.stringify(full)).toString('base64url')
  return `${data}.${sign(data)}`
}

export function decodeOauthState(state: string | null | undefined): OauthStatePayload | null {
  if (!state) return null
  const [data, signature] = state.split('.')
  if (!data || !signature) return null

  const expected = sign(data)
  const expectedBuf = Buffer.from(expected)
  const actualBuf = Buffer.from(signature)
  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    return null
  }

  let payload: OauthStatePayload
  try {
    payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof payload.expiresAt !== 'number' || payload.expiresAt < Date.now()) return null
  return payload
}
