// What only a real Postgres can answer.
//
// Nothing in this package has ever run against a database. The store and verifier suites drive
// hand-written fakes, which the handbook forbids for the database specifically (12.2: "your own
// database — never mock it. A mocked repository happily returns rows the real schema forbids"), and
// the migration had no test at all — it sat at 0% coverage.
//
// The last test here is the reason this file is worth its container. `findOrCreateOauthUser` leans
// on one row per (provider, providerUserId); the entity and the migration both declare that
// constraint, and a fake store happily accepts a second row for the same Google account — which is
// two people sharing one identity. Only the server enforces it, so only the server can prove it.
//
//   # nothing to set up — a container is started per run
//   npm run test:db
//
//   # or point it at a server you already have (what CI does, via its postgres service)
//   CLIENT_AUTH_TEST_PG_URL=postgres://postgres:postgres@localhost:5432/client_auth npm run test:db
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import { Migrator } from '@mikro-orm/migrations'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { createSuiteDatabase, dropSuiteDatabase } from '../../../__db__/suite-database.js'
import { OauthAccount } from '../data/entities.js'
import { Migration20260704120000 } from './Migration20260704120000.js'

const MIGRATIONS = [{ name: 'Migration20260704120000', class: Migration20260704120000 }]

let container: StartedPostgreSqlContainer | undefined
let serverUrl: string
let suiteUrl: string
let orm: MikroORM

beforeAll(async () => {
  serverUrl = process.env.CLIENT_AUTH_TEST_PG_URL ?? ''
  if (!serverUrl) {
    container = await new PostgreSqlContainer('postgres:17').start()
    serverUrl = container.getConnectionUri()
  }
  // This suite's own database on that server: the suites each own their schema, so they must
  // not share one. See src/__db__/suite-database.ts.
  suiteUrl = await createSuiteDatabase('client_auth_migration', serverUrl)
  const url = suiteUrl
  orm = await MikroORM.init({
    clientUrl: url,
    entities: [OauthAccount],
    extensions: [Migrator],
    migrations: { migrationsList: MIGRATIONS },
    discovery: { warnWhenNoEntities: false },
    logger: () => {},
  })
  // Clean state BEFORE, not only after (12.7). This suite asserts what applying the migration to an
  // *empty* database does, so it must not inherit one: the store suite in this same project builds
  // its schema from entity metadata, a developer may point CLIENT_AUTH_TEST_PG_URL at a server they
  // keep, and a crashed previous run leaves its tables behind. Without this the suite fails with
  // `relation "client_auth_oauth_accounts" already exists`, which says nothing about the migration.
  await orm.schema.drop({ dropMigrationsTable: true })
  await orm.migrator.up()
}, 120_000)

afterAll(async () => {
  await orm?.close(true)
  if (suiteUrl && !container) await dropSuiteDatabase(suiteUrl, serverUrl)
  await container?.stop()
})

const tablesIn = async (): Promise<string[]> => {
  const rows = await orm.em.getConnection().execute<{ table_name: string }[]>(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_name like 'client\\_auth\\_%' order by table_name`,
  )
  return rows.map((row) => row.table_name)
}

// A forked EntityManager per test: MikroORM refuses context-specific work on the global instance,
// and a fork per test is also how the app gets one per request.
const scoped = () => orm.em.fork()

const account = (em: EntityManager, overrides: Partial<OauthAccount> = {}): OauthAccount =>
  em.create(OauthAccount, {
    userId: crypto.randomUUID(),
    provider: 'google',
    providerUserId: `sub-${crypto.randomUUID()}`,
    ...overrides,
  })

describe('the committed migration, applied to a real server', () => {
  it('builds the table the module owns', async () => {
    expect(await tablesIn()).toEqual(['client_auth_oauth_accounts'])
  })

  // The assertion no parser can make: if the migration and the entity disagree about a column, a
  // type, a nullability or an index, the ORM asks for DDL here and names what drifted.
  it('leaves a schema the entity has nothing left to change', async () => {
    const pending = await orm.schema.getUpdateSchemaSQL({ safe: true })
    const unexplained = pending
      .split('\n')
      .map((line) => line.trim())
      // `set names 'utf8';` prefixes every diff and is not a change.
      .filter((line) => line !== '' && line !== "set names 'utf8';")

    expect(unexplained).toEqual([])
  })

  // One OAuth identity belongs to one user. The constraint is declared twice — `@Unique` on the
  // entity, `add constraint … unique` in the migration — and until now nothing checked that the
  // database actually refuses the second row.
  it('refuses a second account for the same provider subject', async () => {
    const em = scoped()
    em.persist(account(em, { provider: 'google', providerUserId: 'shared-subject' }))
    await em.flush()

    const theft = scoped()
    theft.persist(account(theft, { provider: 'google', providerUserId: 'shared-subject' }))

    await expect(theft.flush()).rejects.toThrow(/client_auth_oauth_accounts_provider_subject_uq/)
  })

  it('lets the same subject exist once per provider', async () => {
    const em = scoped()
    em.persist(account(em, { provider: 'google', providerUserId: 'same-string' }))
    em.persist(account(em, { provider: 'apple', providerUserId: 'same-string' }))

    await expect(em.flush()).resolves.toBeUndefined()
  })

  // `down()` is written and has never been executed. A module whose rollback does not work cannot
  // be backed out of a client's database.
  it('rolls back, leaving none of its tables behind', async () => {
    await orm.migrator.down({ to: 0 })

    expect(await tablesIn()).toEqual([])
  })
})
