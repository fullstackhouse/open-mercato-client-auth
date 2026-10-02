// The session endpoints, over HTTP, against a real database.
//
// `session-handlers.test.ts` next door mocks the container, the AuthService and the stores, and
// asserts the JSON each handler returns. What it cannot show is any of the things an SPA actually
// depends on: that signup leaves a user it can log in as, that login's cookies get a later request
// through `/session`, that logout makes those same cookies stop working, and — the one with a bug
// behind it — that a speculative `/refresh` with no token does **not** send `Set-Cookie` clearing
// headers that would wipe a session a racing login had just established.
//
// That last behaviour was fixed in #4 and has had no test that could catch its return: proving it
// needs a real response's real headers, which is what this suite reads.
//
// No sandbox application is needed. The bootstrap calls a host makes — `registerOrmEntities`,
// `registerDiRegistrars` — are exported, and the handlers resolve their own `em` from the container
// they build, so pointing `DATABASE_URL` at a throwaway Postgres is the whole setup.
//
//   npm run test:db     # testcontainers; or set CLIENT_AUTH_TEST_PG_URL
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MikroORM } from '@mikro-orm/postgresql'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { createSuiteDatabase, dropSuiteDatabase } from '../../../__db__/suite-database.js'
import { getOrm, registerOrmEntities } from '@open-mercato/shared/lib/db/mikro'
import { registerDiRegistrars } from '@open-mercato/shared/lib/di/container'
import { bootstrapTest } from '@open-mercato/shared/lib/testing/bootstrap'
import { Role, RoleAcl, Session, User, UserAcl, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { OauthAccount } from '../data/entities.js'

const ORIGIN = 'https://app.example.test'
const EMAIL = 'ada@example.test'
const PASSWORD = 'correct horse battery staple'

let container: StartedPostgreSqlContainer | undefined
let serverUrl: string
let suiteUrl: string
let orm: MikroORM

const CORE = [User, Role, UserRole, UserAcl, RoleAcl, Session, Tenant]

beforeAll(async () => {
  process.env.JWT_SECRET ??= 'test-jwt-secret-at-least-32-characters-long'

  serverUrl = process.env.CLIENT_AUTH_TEST_PG_URL ?? ''
  if (!serverUrl) {
    container = await new PostgreSqlContainer('postgres:17').start()
    serverUrl = container.getConnectionUri()
  }
  // This suite's own database on that server: the suites each own their schema, so they must
  // not share one. See src/__db__/suite-database.ts.
  suiteUrl = await createSuiteDatabase('client_auth_http', serverUrl)
  const url = suiteUrl
  // The container resolves its own ORM from this, which is how the handlers get an `em`.
  process.env.DATABASE_URL = url

  const entities = [OauthAccount, ...CORE]
  orm = await MikroORM.init({
    clientUrl: url,
    entities,
    discovery: { warnWhenNoEntities: false },
    logger: () => {},
  })
  await orm.schema.drop({ dropMigrationsTable: true })
  await orm.schema.create()

  registerOrmEntities(entities)
  // What stops the shared container looking for an app's `@/di` module.
  registerDiRegistrars([])
  // Shared ships this for exactly this purpose: the module registry the i18n and query layers read
  // on the way through a handler. An empty set is enough — no module of ours is being resolved.
  await bootstrapTest({ modules: [] })
}, 240_000)

afterAll(async () => {
  // The handlers' own ORM, created by shared on first use. Closing it before the container goes
  // away is what keeps teardown quiet: a live pool against a stopped server logs a wall of
  // `57P01 terminating connection` objects, and output nobody reads is output nobody checks.
  await (await getOrm().catch(() => null))?.close(true)
  await orm?.close(true)
  if (suiteUrl && !container) await dropSuiteDatabase(suiteUrl, serverUrl)
  await container?.stop()
})

beforeEach(async () => {
  const em = orm.em.fork()
  await em.nativeDelete(OauthAccount, {})
  await em.nativeDelete(Session, {})
  await em.nativeDelete(UserRole, {})
  await em.nativeDelete(User, {})
  await em.nativeDelete(Tenant, {})
  // `createCoreUser` refuses without an active tenant — its documented `no-tenant` contract.
  em.persist(em.create(Tenant, { name: 'Acme', isActive: true } as never))
  await em.flush()
})

const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

const cookieHeaderFrom = (res: Response): string =>
  res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .filter((pair) => !pair.endsWith('='))
    .join('; ')

const signup = async () => {
  const { POST } = await import('./signup/route.js')
  return POST(json('/api/client_auth/signup', { email: EMAIL, password: PASSWORD, name: 'Ada' }))
}

const login = async (password = PASSWORD) => {
  const { POST } = await import('./login/route.js')
  return POST(json('/api/client_auth/login', { email: EMAIL, password }))
}

describe('signup and login over HTTP', () => {
  it('signs a new client up and leaves a user it can log in as', async () => {
    const res = await signup()

    // 201: signup creates a user, and the route says so rather than answering a flat 200.
    expect(res.status).toBe(201)
    expect(await orm.em.fork().count(User, { email: EMAIL })).toBe(1)

    const loggedIn = await login()
    expect(loggedIn.status).toBe(200)
  })

  it('sets session cookies on login and records the session', async () => {
    await signup()

    const res = await login()

    expect(res.status).toBe(200)
    const cookies = res.headers.getSetCookie()
    expect(cookies.length).toBeGreaterThanOrEqual(1)
    for (const cookie of cookies) expect(cookie).toMatch(/HttpOnly/i)
    expect(await orm.em.fork().count(Session, {})).toBeGreaterThanOrEqual(1)
  })

  it('refuses a wrong password without setting a cookie', async () => {
    await signup()

    const res = await login('not the password')

    expect(res.status).toBe(401)
    expect(res.headers.getSetCookie()).toEqual([])
  })
})

describe('the session a login mints', () => {
  it('answers /session for a request carrying it, and 401 for one that is not', async () => {
    await signup()
    const loggedIn = await login()
    const { GET } = await import('./session/route.js')

    const withCookie = await GET(
      new Request(`${ORIGIN}/api/client_auth/session`, {
        headers: { cookie: cookieHeaderFrom(loggedIn) },
      }),
    )
    const without = await GET(new Request(`${ORIGIN}/api/client_auth/session`))

    expect(withCookie.status).toBe(200)
    await expect(withCookie.clone().json()).resolves.toMatchObject({ user: { email: EMAIL } })
    expect(without.status).toBe(401)
  })

  it('stops working after logout, which also revokes the row', async () => {
    await signup()
    const loggedIn = await login()
    const cookie = cookieHeaderFrom(loggedIn)

    const { POST: logout } = await import('./logout/route.js')
    const loggedOut = await logout(json('/api/client_auth/logout', {}, { cookie }))
    expect(loggedOut.status).toBe(200)

    const { GET } = await import('./session/route.js')
    const after = await GET(
      new Request(`${ORIGIN}/api/client_auth/session`, { headers: { cookie } }),
    )
    expect(after.status).toBe(401)
  })
})

describe('/refresh', () => {
  it('exchanges a session token for a fresh access token', async () => {
    await signup()
    const loggedIn = await login()

    const { POST } = await import('./refresh/route.js')
    const res = await POST(json('/api/client_auth/refresh', {}, { cookie: cookieHeaderFrom(loggedIn) }))

    expect(res.status).toBe(200)
    await expect(res.clone().json()).resolves.toMatchObject({ ok: true })
    expect(res.headers.getSetCookie().join('\n')).toMatch(/auth_token=/)
  })

  // The regression #4 fixed, and the reason this suite reads real headers. A client probes this
  // endpoint speculatively on page load; the anonymous case is the common one and it races every
  // fast login. If the response cleared cookies, it would log out a session established while this
  // request was in flight.
  it('clears nothing when no token was presented', async () => {
    const { POST } = await import('./refresh/route.js')

    const res = await POST(json('/api/client_auth/refresh', {}))

    expect(res.status).toBe(401)
    expect(res.headers.getSetCookie()).toEqual([])
  })

  // The other half of the same decision: a token that WAS presented and proved invalid is stale,
  // and those cookies genuinely should go.
  it('clears the cookies when a presented token proves invalid', async () => {
    const { POST } = await import('./refresh/route.js')

    const res = await POST(
      json('/api/client_auth/refresh', {}, { cookie: 'session_token=not-a-real-token' }),
    )

    expect(res.status).toBe(401)
    const cleared = res.headers.getSetCookie()
    expect(cleared.length).toBeGreaterThan(0)
    // A clearing cookie is an empty value with an immediate expiry.
    expect(cleared.join('\n')).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i)
  })
})
