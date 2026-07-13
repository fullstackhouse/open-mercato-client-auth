import { SignJWT, importPKCS8 } from 'jose'

const APPLE_CLIENT_SECRET_TTL_SECONDS = 180 * 24 * 60 * 60

/**
 * Apple requires the OAuth client secret to be a short-lived ES256 JWT signed
 * with the developer's private key. Some deployments store a pre-generated
 * JWT in APPLE_CLIENT_SECRET; others provide the raw key. Support both: a
 * static APPLE_CLIENT_SECRET wins, otherwise sign one from
 * APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY.
 */
export async function generateAppleClientSecret(): Promise<string> {
  const staticSecret = process.env.APPLE_CLIENT_SECRET
  if (staticSecret) return staticSecret

  const teamId = process.env.APPLE_TEAM_ID
  const keyId = process.env.APPLE_KEY_ID
  const clientId = process.env.APPLE_CLIENT_ID
  const privateKey = process.env.APPLE_PRIVATE_KEY

  if (!teamId || !keyId || !clientId || !privateKey) {
    return ''
  }

  try {
    const key = await importPKCS8(privateKey.replace(/\\n/g, '\n'), 'ES256')
    const now = Math.floor(Date.now() / 1000)

    return await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: keyId })
      .setIssuer(teamId)
      .setSubject(clientId)
      .setAudience('https://appleid.apple.com')
      .setIssuedAt(now)
      .setExpirationTime(now + APPLE_CLIENT_SECRET_TTL_SECONDS)
      .sign(key)
  } catch (error) {
    console.error('[client_auth] failed to generate Apple client secret', {
      reason: error instanceof Error ? error.message : String(error),
    })
    return ''
  }
}
