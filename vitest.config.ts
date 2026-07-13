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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts'],
    },
  },
})
