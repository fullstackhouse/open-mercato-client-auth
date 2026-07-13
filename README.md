# @fullstackhouse/open-mercato-client-auth

Authentication for *external clients* of an [Open Mercato](https://github.com/open-mercato/open-mercato)
application — SPAs, mobile apps, and other first-party clients that are not
the `/backend` staff console. It provides JSON session endpoints, Google and
Apple OAuth, and a pluggable verifier/store architecture, all issuing regular
core-auth platform sessions (the same JWT + refresh-token pair as core login),
so signed-in clients look identical to the rest of the system regardless of
how they signed in.

## Status

**v0.1 — OAuth port.** Google and Apple sign-in (web code+PKCE flow, native
id-token flow, Apple ES256 client secret + `form_post` handling), the
`issueSession()` seam, cookie/body transports, and the core-auth user store.

**Next (SPEC-055 endpoints):** the JSON session endpoint contract — `login`,
`session` (whoami), `refresh`, `logout`, `signup`,
`password-reset/{request,confirm}` — lands under `/api/client_auth/*` in the
following release. Their directories exist as stubs under
`src/modules/client_auth/api/`.

An integration-test harness (ephemeral host app in CI) is planned but not yet
part of this repo.

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

## Endpoints (v0.1)

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
  in the default tenant with no roles and no organization. Unverified provider
  emails are always refused.
- Web flows finish with HttpOnly `auth_token` / `session_token` cookies;
  mobile flows get tokens back through the deep-link redirect
  (`OAUTH_MOBILE_REDIRECT_URI`) or the `token` endpoints' JSON body. Both
  transports are accepted by core `getAuthFromRequest` unchanged.

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
| `JWT_SECRET` | Core auth secret; also HMAC-signs the stateless OAuth `state` payload. |

A provider with missing credentials simply reports itself as unavailable —
the module is safe to enable without any configuration.

## Architecture

`src/modules/client_auth/` is thin HTTP glue (routes, entities, migrations,
i18n). The reusable machinery lives above it and is exported from the package
root so hosts can compose pieces without the module:

- **`session/`** — `issueSession(em, user)` and the cookie transport helpers.
- **`verifiers/`** — credential verification. `oauth/` today; password (over
  core `AuthService`) next.
- **`stores/`** — the user-store adapter seam.
- **`config.ts`** — all env-driven configuration.

### The verifier → `issueSession()` seam

Every sign-in method is a *credential verifier* that resolves a verified core
`User`; exactly one function turns that into a platform session:

```ts
import { issueSession, setSessionCookies } from '@fullstackhouse/open-mercato-client-auth'

const session = await issueSession(em, verifiedUser) // { token, refreshToken, expiresAt }
setSessionCookies(res, session) // web transport; native clients read the body instead
```

Google and Apple are the verifiers today. Future methods (password, OTP,
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
  // Phase 2 will add findByEmail / verifyPassword for password login+signup.
}
```

v1 ships exactly one implementation, `CoreAuthUserStore`: client users are
core `auth` users ("customer" is a role with zero backend features, not a
separate table). The seam exists so a `customer_accounts`-backed store can
follow without touching the verifiers.

## Data model & migration compatibility

One table, `better_auth_oauth_accounts` — one row per linked provider
identity (`provider` + `provider_user_id` unique), linked to `core:auth.user`
via a `defineLink` extension; core auth tables are never modified. Provider
access/refresh tokens are stored **hashed** (SHA-256).

The table deliberately keeps its historical `better_auth_*` name: hosts
migrating from a hand-rolled `better_auth` app module (e.g. Tournee's
SPEC-017 module) adopt their existing OAuth links with zero data migration —
only the module id and endpoint prefix change (`better_auth` → `client_auth`).

Note: module *registration* from an arbitrary package is a confirmed Open
Mercato capability, but migration discovery from package-backed modules is
still being verified against 0.6.x (this is the first fsh package module that
ships entities + migrations). If your host's `db migrate` does not pick up
the packaged migration, create the table via a host-side migration with the
same SQL until that story is confirmed.

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
