/**
 * Builds every bundle on its own, the way deployed modules are built.
 *
 * Each build emits `index.js` plus a `manifest.json` whose `provides` is derived
 * from the `@component()` declarations, into `dist-bundles/<id>/` — which is
 * what the host discovers at runtime through the PluginRegistry.
 */

import { readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const bundlesDir = join(here, 'bundles')

const entries = await readdir(bundlesDir, { withFileTypes: true })
const bundles = entries.filter(entry => entry.isDirectory()).map(entry => entry.name)

for (const bundle of bundles) {
  process.stdout.write(`building ${bundle} … `)
  await build({ configFile: resolve(bundlesDir, bundle, 'vite.config.ts') })
  process.stdout.write('done\n')
}

// The repository index the host fetches first
const index = {
  name: 'Workbench bundles',
  description: 'Separately built modules, discovered at runtime',
  version: '1',
  modules: bundles
}
await writeFile(
  join(here, 'dist-bundles', 'index.json'),
  `${JSON.stringify(index, null, 2)}\n`
)

console.log(`\n${bundles.length} bundle(s) built, index.json written`)
