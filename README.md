# @fullstackhouse/open-mercato-client-auth

Authentication for *external clients* of an [Open Mercato](https://github.com/open-mercato/open-mercato)
application — SPAs, mobile apps, and other first-party clients that are not
the `/backend` staff console. It provides JSON session endpoints, Google and
Apple OAuth, and a pluggable verifier/store architecture, all issuing regular
core-auth platform sessions (the same JWT + refresh-token pair as core login),
so signed-in clients look identical to the rest of the system regardless of
how they signed in.

## Status

**v0.2 — JSON session endpoints.** The full SPEC-055 §D contract — `login`,
`session` (whoami), `refresh`, `logout`, `signup`,
`password-reset/{request,confirm}` — is implemented under `/api/client_auth/*`
over core `AuthService`, alongside the v0.1 Google/Apple OAuth port, the
`issueSession()` seam, cookie/body transports, and the core-auth user store.

**Next:** the `better-auth` verifier engine (feature-gated; drawn from real
product need — OTP / passkeys / device flow) and an integration-test harness
(ephemeral host app in CI) are planned but not yet part of this repo — unit
tests cover the verifier/store/transport logic.

## Install

```bash
npm install @fullstackhouse/open-mercato-client-auth
# peer deps: @open-mercato/core, @open-mercato/shared, @mikro-orm/* (v7), next, zod
```

Register the module in your app's `src/modules.ts`:

```ts
const modules = [
  // ...core modules...
  { id: 'client_auth', from: '@fullstackhouse/open-mercato-client-auth' },
]
```

The package ships the compiled module tree at `dist/modules/client_auth/`,
which is where the Open Mercato CLI resolves package-backed modules from.
Then run `yarn generate` (or `mercato generate`) and apply migrations.

## Endpoints

### Session (email/password)

| Endpoint | Purpose |
|----------|---------|
| `POST /api/client_auth/login` | `{ email, password }` → verifies credentials, issues a session. Responds `{ ok, token, refreshToken, expiresAt, user }` **and** sets cookies. |
| `GET /api/client_auth/session` | Whoami. Reads the cookie or bearer token → `{ user, expiresAt }`; `401` when unauthenticated. |
| `POST /api/client_auth/refresh` | `session_token` cookie or `{ refreshToken }` → a fresh access JWT (`{ ok, token, expiresAt, user }` + cookie), reusing the same refresh token. `401` (+ cleared cookies) when the refresh token is invalid/expired. |
| `POST /api/client_auth/logout` | Revokes the session row (from the `session_token` cookie or `{ refreshToken }`) and clears cookies. |
| `POST /api/client_auth/signup` | `{ email, password, name? }` → creates a confirmed user in the default tenant with the base role, then issues a session (`201`). `409` when the email is taken; `403` when signup is disabled. |
| `POST /api/client_auth/password-reset/request` | `{ email, redirectTo? }` → **always** `{ ok: true }` (anti-enumeration). When the email exists, emits `client_auth.password_reset.requested` carrying the reset token so the host sends the email. |
| `POST /api/client_auth/password-reset/confirm` | `{ token, newPassword }` → resets the password (core revokes all of the user's sessions). `400` on an invalid/expired token. |

`expiresAt` is the **access-token** (8h) expiry — what clients use to schedule
a preemptive refresh; the refresh token lives `REFRESH_TOKEN_DAYS` (30d).

> **Password-reset email is the host's job.** The package creates the core
> `PasswordReset` token and emits `client_auth.password_reset.requested`
> (`{ userId, email, token, redirectTo, tenantId }`). Subscribe to it and send
> the email via your notifications stack with a link to your frontend's
> reset-password screen. The package intentionally owns no email templates.

### OAuth (Google / Apple)

| Endpoint | Purpose |
|----------|---------|
| `POST /api/client_auth/oauth/google/init` | Start Google sign-in (returns the authorization URL). Body: `{ platform: 'web'\|'mobile', redirect? }` |
| `GET /api/client_auth/oauth/google/callback` | Google redirects here; finishes sign-in |
| `POST /api/client_auth/oauth/google/token` | Native flow: verify a Google ID token obtained on-device |
| `POST /api/client_auth/oauth/apple/init` | Start Apple sign-in |
| `GET/POST /api/client_auth/oauth/apple/callback` | Apple redirects here (`form_post`); finishes sign-in |
| `POST /api/client_auth/oauth/apple/token` | Native flow: verify an Apple identity token obtained on-device |

Behavior:

- If a user with the same (provider-verified) email already exists, the OAuth
  identity is linked to it; otherwise a new, already-confirmed user is created
  in the default tenant with the base role (`CLIENT_AUTH_DEFAULT_ROLE`) and no
  organization. Unverified provider emails are always refused.
- Web flows finish with HttpOnly `auth_token` / `session_token` cookies;
  mobile flows get tokens back through the deep-link redirect
  (`OAUTH_MOBILE_REDIRECT_URI`) or the `token` endpoints' JSON body. Both
  transports are accepted by core `getAuthFromRequest` unchanged.

### Transports

- **Web (same-site):** HttpOnly `auth_token` (JWT) + `session_token` (refresh)
  cookies, `SameSite=Lax`, `Secure` in production. JS never sees the JWT;
  identity comes from the `session` (whoami) endpoint.
- **Native / cross-site:** the response-body `token` / `refreshToken` (send
  `Authorization: Bearer <token>`). Cookies are ignored.

## Configuration (env)

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials. Unset ⇒ Google reports itself unavailable. |
| `APPLE_CLIENT_ID` | Apple Services ID. Unset ⇒ Apple reports itself unavailable. |
| `APPLE_CLIENT_SECRET` | Pre-generated Apple client-secret JWT (wins over key-based signing). |
| `APPLE_TEAM_ID` / `APPLE_KEY_ID` / `APPLE_PRIVATE_KEY` | Alternative to `APPLE_CLIENT_SECRET`: the module signs the ES256 client secret itself. |
| `OAUTH_MOBILE_REDIRECT_URI` | Deep link that mobile flows redirect back to. Defaults to `tourneeapp://auth/callback` (legacy default from the first consumer — set it explicitly in new apps). |
| `OAUTH_WEB_REDIRECT_ORIGINS` | Comma-separated origins that web flows may redirect to after sign-in (for SPAs served from another origin). Absolute `redirect` URLs are honored only when their origin is listed; anything else falls back to same-app path-only redirects. Empty by default. |
| `REFRESH_TOKEN_DAYS` | Session/refresh-token lifetime in days (default 30). |
| `CLIENT_AUTH_SIGNUP_ENABLED` | Set to `false`/`0`/`no` to make `POST /signup` return `403` (invite-only deployments). Enabled by default. |
| `CLIENT_AUTH_DEFAULT_ROLE` | Role granted to every new client user (password signup **and** first-time OAuth) — the base authenticated-user role in your RBAC vocabulary. Unset ⇒ no role is granted. A configured name that isn't found in the tenant is skipped (logged), never blocking account creation. |
| `CLIENT_AUTH_PASSWORD_MIN_LENGTH` | Minimum password length for signup and reset-confirm (default 8). |
| `JWT_SECRET` | Core auth secret; also HMAC-signs the stateless OAuth `state` payload. |

A provider with missing credentials simply reports itself as unavailable —
the module is safe to enable without any configuration.

> **Rate limiting** is deliberately not implemented in the module — apply it at
> the host edge (the mercato proxy / middleware) where the shared limiter and
> IP context live. `login`, `signup`, and `password-reset/request` are the
> endpoints to protect.

## Architecture

`src/modules/client_auth/` is thin HTTP glue (routes, entities, migrations,
i18n). The reusable machinery lives above it and is exported from the package
root so hosts can compose pieces without the module:

- **`session/`** — `issueSession(em, user)`, the access-token builder, the
  cookie transport helpers, and `toUserView`.
- **`verifiers/`** — credential verification: `password/` (over core
  `AuthService`) and `oauth/`.
- **`stores/`** — the user-store adapter seam + `createCoreUser`.
- **`config.ts`** — all env-driven configuration.

### The verifier → `issueSession()` seam

Every sign-in method is a *credential verifier* that resolves a verified core
`User`; exactly one function turns that into a platform session:

```ts
import { issueSession, setSessionCookies } from '@fullstackhouse/open-mercato-client-auth'

// { token, refreshToken, accessExpiresAt, refreshExpiresAt }
const session = await issueSession(em, verifiedUser)
setSessionCookies(res, session) // web transport; native clients read the body instead
```

Password, Google, and Apple are the verifiers today. Future methods (OTP,
magic links, passkeys — potentially via the `better-auth` library mounted as
a verification engine) plug in behind the same seam; nothing downstream
changes when a verifier is added.

### The user-store contract

Verifiers resolve users through a `UserStore` adapter, so *where client users
live* is swappable:

```ts
export interface UserStore {
  findOrCreateFromOauth(params: {
    identity: OauthIdentity
    tokens: OauthTokenResponse | null
  }): Promise<FindOrCreateOauthUserResult>
  verifyCredentials(email: string, password: string): Promise<User | null>
  createUser(params: { email: string; password: string; name?: string | null }): Promise<CreateUserResult>
}
```

v1 ships exactly one implementation, `CoreAuthUserStore`: client users are
core `auth` users ("customer" is a role with zero backend features, not a
separate table). The seam exists so a `customer_accounts`-backed store can
follow without touching the verifiers.

## Data model & migration compatibility

One table, `client_auth_oauth_accounts` — one row per linked provider
identity (`provider` + `provider_user_id` unique), linked to `core:auth.user`
via a `defineLink` extension; core auth tables are never modified. Provider
access/refresh tokens are stored **hashed** (SHA-256).

Both module *registration* and *migration discovery* from an arbitrary package
are first-class in the Open Mercato CLI (it resolves `from:` to
`node_modules/<pkg>/dist/modules/<id>/migrations` and tracks each module in its
own `mikro_orm_migrations_<moduleId>` table).

**Migrating from a hand-rolled `better_auth` module** (e.g. Tournee's SPEC-017
module): before the `client_auth` migration runs, rename the existing objects
so the data survives and the migration is recognised as already applied —
`ALTER TABLE better_auth_oauth_accounts RENAME TO client_auth_oauth_accounts`
(plus its constraint/index names) and
`ALTER TABLE mikro_orm_migrations_better_auth RENAME TO mikro_orm_migrations_client_auth`.
Fresh databases need nothing — the migration creates the table directly.

## Development

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
```

The build is bundle-less (`tsup` with `bundle: false`): the compiled `dist/`
tree mirrors `src/` one-to-one, which is required both by the CLI's
`dist/modules/<module>` resolution and by MikroORM (the entity class must
exist exactly once in the output).

## License

MIT © Full Stack House
