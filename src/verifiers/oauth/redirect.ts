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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * An allowlist entry may carry a single `*`, which stands for exactly one
 * host label: `https://*.example.com` admits `https://tenant.example.com` and
 * refuses `https://tenant.evil.example.com`. Deployments that serve one app
 * per tenant subdomain would otherwise have to name every tenant, which they
 * cannot — tenants come and go without a redeploy.
 */
function originMatchesEntry(origin: string, entry: string): boolean {
  if (!entry.includes('*')) return entry === origin
  const pattern = entry.split('*').map(escapeRegExp).join('[^./]+')
  return new RegExp(`^${pattern}$`).test(origin)
}

export function isAllowedWebRedirectOrigin(origin: string): boolean {
  return getWebRedirectOrigins().some((entry) => originMatchesEntry(origin, entry))
}

/**
 * True when the caller asked to be redirected to an absolute URL that the
 * allowlist does not admit. Callers use this to refuse the flow up front
 * rather than send the user to the provider and silently redirect them
 * somewhere else on the way back.
 */
export function isRefusedWebRedirect(redirect: string | null | undefined): boolean {
  if (!redirect) return false
  const absolute = parseAbsoluteUrl(redirect)
  return absolute !== null && !isAllowedWebRedirectOrigin(absolute.origin)
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
    if (absolute && isAllowedWebRedirectOrigin(absolute.origin)) {
      return absolute.toString()
    }
  }
  return sanitizeRedirectPath(redirect ?? undefined, baseUrl, '/')
}
