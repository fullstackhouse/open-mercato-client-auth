import { Client } from 'pg'

/**
 * A database of this suite's own, on whatever server the URL points at.
 *
 * Why: the `*.db.test.ts` suites each establish their own schema — one applies the committed
 * migrations to an empty database and asserts exactly that, one builds core's tables from entity
 * metadata, one rolls everything back on the way out. Pointed at a single shared database (which is
 * what CI's `postgres` service is, and what a developer's own server is) their cleanups are
 * mutually destructive: dropping the migrations ledger makes the next suite try to create tables
 * that already exist, and rolling back to zero deletes the tables another suite is mid-way through.
 *
 * Taking turns would make the order load-bearing, so instead nobody shares: one database per
 * suite, named per run. Same reasoning as the handbook's rule for shared databases (12.7) — prefer
 * not colliding over taking it in turns — applied one level up, at the schema rather than the row.
 */
export async function createSuiteDatabase(suite: string, serverUrl: string): Promise<string> {
  const name = `${suite}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  const admin = new Client({ connectionString: serverUrl })
  await admin.connect()
  try {
    await admin.query(`create database "${name}"`)
  } finally {
    await admin.end()
  }
  const url = new URL(serverUrl)
  url.pathname = `/${name}`
  return url.toString()
}

/**
 * Drops it again, so a developer pointing the suites at a server they keep does not accumulate one
 * database per run. Never throws: a failure here is housekeeping, not a test result.
 */
export async function dropSuiteDatabase(suiteUrl: string, serverUrl: string): Promise<void> {
  const name = new URL(suiteUrl).pathname.replace(/^\//, '')
  if (!name) return
  const admin = new Client({ connectionString: serverUrl })
  try {
    await admin.connect()
    await admin.query(`drop database if exists "${name}" with (force)`)
  } catch {
    // Housekeeping only.
  } finally {
    await admin.end().catch(() => {})
  }
}
