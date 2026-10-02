import path from 'node:path'
import { defineConfig } from 'vitest/config'

// The database-backed suite, kept out of `npm test` on purpose: the fast suite must stay runnable
// with nothing installed, and a container-dependent test inside it would be a suite that is red on
// a laptop and green in CI, or the reverse.
const omSrc = (pkg: string) => path.resolve(__dirname, `node_modules/@open-mercato/${pkg}/src`)

export default defineConfig({
  esbuild: {
    tsconfigRaw: {
      compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false },
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
    include: ['src/**/*.db.test.ts'],
    // One server, one schema per run: these suites migrate and roll back the same database.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
})
