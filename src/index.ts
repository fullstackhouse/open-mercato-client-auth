export {
  OAUTH_PROVIDERS,
  type OauthProvider,
  type OauthProviderConfig,
  getProviderConfig,
  getMobileRedirectUri,
  getWebRedirectOrigins,
  getSessionDays,
  DEFAULT_MOBILE_REDIRECT_URI,
  DEFAULT_SESSION_DAYS,
} from './config.js'

export { issueSession, type IssuedSession } from './session/issue-session.js'
export {
  setSessionCookies,
  clearSessionCookies,
  AUTH_TOKEN_COOKIE_NAME,
  SESSION_TOKEN_COOKIE_NAME,
  ACCESS_TOKEN_MAX_AGE_SECONDS,
} from './session/transports.js'

export type { UserStore } from './stores/types.js'
export { CoreAuthUserStore, createCoreAuthUserStore } from './stores/core-auth.js'

export {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  verifyIdToken,
  type OauthIdentity,
  type OauthTokenResponse,
} from './verifiers/oauth/providers.js'
export { generatePkcePair, type PkcePair } from './verifiers/oauth/pkce.js'
export { encodeOauthState, decodeOauthState, type OauthStatePayload } from './verifiers/oauth/oauth-state.js'
export { generateAppleClientSecret } from './verifiers/oauth/apple-client-secret.js'
export { hashToken } from './verifiers/oauth/token-hash.js'
export {
  findOrCreateOauthUser,
  type FindOrCreateOauthUserResult,
} from './verifiers/oauth/find-or-create-oauth-user.js'
export { resolveWebRedirect } from './verifiers/oauth/redirect.js'
