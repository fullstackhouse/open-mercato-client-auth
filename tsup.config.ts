import { defineConfig } from 'tsup'

// Bundle-less build: every source file is transpiled in place so the compiled
// tree mirrors src/ one-to-one. This matters for two reasons:
// - the Open Mercato CLI resolves module trees from
//   node_modules/<pkg>/dist/modules/<module>/..., so the file layout is the
//   contract;
// - MikroORM entity classes (src/modules/client_auth/data/entities.ts) must
//   exist exactly once in the output — per-entry bundling would duplicate the
//   class into every importer.
export default defineConfig({
  entry: ['src/**/*.ts', '!src/**/*.test.ts', '!src/**/__tests__/**'],
  format: ['esm'],
  bundle: false,
  splitting: false,
  dts: false,
  sourcemap: true,
  clean: true,
  // tsup only emits the transpiled .ts tree; module assets (i18n JSON) must be
  // copied verbatim so the CLI can import them from the published dist/.
  onSuccess: 'node scripts/copy-assets.mjs',
})
