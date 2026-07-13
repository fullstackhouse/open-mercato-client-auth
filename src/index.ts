export {
  OAUTH_PROVIDERS,
  type OauthProvider,
  type OauthProviderConfig,
  getProviderConfig,
  getMobileRedirectUri,
  getWebRedirectOrigins,
  getSessionDays,
  getPasswordMinLength,
  isSignupEnabled,
  getDefaultRoleName,
  DEFAULT_MOBILE_REDIRECT_URI,
  DEFAULT_SESSION_DAYS,
  DEFAULT_PASSWORD_MIN_LENGTH,
} from './config.js'

export {
  issueSession,
  buildAccessToken,
  accessTokenExpiry,
  ACCESS_TOKEN_TTL_SECONDS,
  type IssuedSession,
} from './session/issue-session.js'
export {
  setSessionCookies,
  setAccessTokenCookie,
  clearSessionCookies,
  readRequestCookie,
  AUTH_TOKEN_COOKIE_NAME,
  SESSION_TOKEN_COOKIE_NAME,
  ACCESS_TOKEN_MAX_AGE_SECONDS,
} from './session/transports.js'
export { toUserView, type UserView } from './session/user-view.js'

export type { UserStore, CreateUserResult } from './stores/types.js'
export { CoreAuthUserStore, createCoreAuthUserStore } from './stores/core-auth.js'
export { createCoreUser, type CreateCoreUserParams } from './stores/create-user.js'

export { verifyCredentials } from './verifiers/password/verify-credentials.js'
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
