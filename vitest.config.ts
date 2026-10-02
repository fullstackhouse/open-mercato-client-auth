import path from 'node:path'
import { defineConfig } from 'vitest/config'

// The published @open-mercato packages use multi-star `exports` patterns
// (e.g. "./*/*/*"), which Node's spec — and therefore Vite's resolver —
// doesn't support (one "*" per pattern). Hosts consume these packages
// through Next/ts-jest, which tolerate them; for vitest we alias deep
// imports straight to the packages' shipped TypeScript sources.
const omSrc = (pkg: string) =>
  path.resolve(__dirname, `node_modules/@open-mercato/${pkg}/src`)

export default defineConfig({
  // MikroORM entities in @open-mercato sources use legacy decorators.
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
      },
    },
  },
  resolve: {
    alias: [
      { find: /^@open-mercato\/core\/(.*)$/, replacement: `${omSrc('core')}/$1` },
      { find: /^@open-mercato\/shared\/(.*)$/, replacement: `${omSrc('shared')}/$1` },
      { find: /^@open-mercato\/events\/(.*)$/, replacement: `${omSrc('events')}/$1` },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // `*.db.test.ts` needs a Postgres server and runs under vitest.db.config.ts (`npm run test:db`).
    // Keeping it out of here is what lets this suite stay runnable with nothing installed.
    exclude: ['**/node_modules/**', '**/dist/**', 'src/**/*.db.test.ts'],
    coverage: {
      provider: 'v8',
      // `json-summary` is what CI reads to print the number into the run summary;
      // the rest are for a human running this locally.
      reporter: ['text', 'json', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.db.test.ts', 'src/**/index.ts'],
      // Deliberately NO thresholds. The number is information for a reviewer — which new
      // code arrived untested — not a bar to climb: a floor that must not fall is a standing
      // incentive to write tests that cannot fail, which the handbook forbids (ch. 12.8,
      // "coverage is not a virtue in itself; information is"). What the uncovered list says
      // today is that the route handlers, the session user-view and the migration have no
      // test at all; the fix for those is an integration test against a real app and a real
      // database (SPEC-028 phase 3), not a unit test written to move this percentage.
    },
  },
})
