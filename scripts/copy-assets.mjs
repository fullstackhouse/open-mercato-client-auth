// Copies non-TypeScript source assets (module i18n JSON, etc.) into dist/,
// preserving the src/ layout. tsup only transpiles .ts, but the Open Mercato
// CLI imports module assets like `.../modules/client_auth/i18n/en.json` from
// the published tree, so those files must exist under dist/ verbatim.
import { readdirSync, statSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'

const SRC = 'src'
const DIST = 'dist'

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) {
      walk(abs)
      continue
    }
    if (abs.endsWith('.ts')) continue // transpiled by tsup
    const dest = join(DIST, relative(SRC, abs))
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(abs, dest)
  }
}

walk(SRC)
