import { sanitizeRedirectPath } from '@open-mercato/core/modules/auth/lib/safeRedirect'
import { getWebRedirectOrigins } from '../../config.js'

function parseAbsoluteUrl(value: string): URL | null {
  if (!/^https?:\/\//i.test(value)) return null
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/**
 * Resolves the post-sign-in redirect for web OAuth flows. Absolute URLs are
 * honored only when their origin is in the OAUTH_WEB_REDIRECT_ORIGINS
 * allowlist (e.g. the SPA served from another origin than the mercato app);
 * anything else falls back to same-app path-only sanitization.
 */
export function resolveWebRedirect(redirect: string | null | undefined, baseUrl: string): string {
  if (redirect) {
    const absolute = parseAbsoluteUrl(redirect)
    if (absolute && getWebRedirectOrigins().includes(absolute.origin)) {
      return absolute.toString()
    }
  }
  return sanitizeRedirectPath(redirect ?? undefined, baseUrl, '/')
}
