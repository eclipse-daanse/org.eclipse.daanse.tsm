/**
 * The component scan resolving a service id out of a package.
 *
 * A service contract belongs in a package of its own — the API bundle — and
 * `@component({ service: [WIDGET_SERVICE] })` is exactly where that constant is
 * needed. Reading only relative imports left every such declaration falling back
 * to a repeated literal (tsm#21).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractComponents } from '../vite/componentScan.js'
import { tsmPlugin } from '../vite/plugin.js'

/** A workspace whose API package points `exports` at its TypeScript source */
async function workspace(): Promise<{ root: string; consumer: string }> {
  const root = await mkdtemp(join(tmpdir(), 'tsm-scan-'))

  const api = join(root, 'node_modules', 'acme-api')
  await mkdir(join(api, 'src'), { recursive: true })
  await writeFile(join(api, 'package.json'), JSON.stringify({
    name: 'acme-api',
    type: 'module',
    exports: { '.': { types: './src/index.ts', import: './src/index.ts' } }
  }))
  await writeFile(join(api, 'src', 'index.ts'), `
    import { serviceId } from '@eclipse-daanse/tsm'
    export interface Widget { label: string }
    // The usual form now: a typed id, declared next to its contract
    export const WIDGET_SERVICE = serviceId<Widget>('acme.widget')
    export const OTHER_SERVICE = 'acme.other'
    export const CAST_SERVICE = 'acme.cast' as const
    export const SYMBOL_SERVICE = Symbol.for('acme.symbol')
  `)

  // A package that resolves to built output, the way a published one does
  const built = join(root, 'node_modules', 'built-api')
  await mkdir(join(built, 'dist'), { recursive: true })
  await mkdir(join(built, 'src'), { recursive: true })
  await writeFile(join(built, 'package.json'), JSON.stringify({
    name: 'built-api', type: 'module', main: './dist/index.js'
  }))
  await writeFile(join(built, 'src', 'index.ts'), `export const BUILT_SERVICE = 'acme.built'`)

  const consumer = join(root, 'src')
  await mkdir(consumer, { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'consumer', type: 'module' }))

  return { root, consumer: join(consumer, 'widget.ts') }
}

describe('the scan, resolving across packages', () => {
  let root = ''
  let consumer = ''

  beforeAll(async () => { ({ root, consumer } = await workspace()) })
  afterAll(async () => { await rm(root, { recursive: true, force: true }) })

  /** The plugin's own resolver, reached through the transform hook */
  async function servicesOf(code: string): Promise<string[]> {
    const plugin = tsmPlugin({ components: 'derive', strict: false, manifest: { id: 'w' } })
    const declared: string[] = []
    const ctx = {
      error(message: string) { throw new Error(message) },
      warn() {},
      emitFile(file: { source: string }) {
        const manifest = JSON.parse(file.source) as { provides?: Array<{ id: string }> }
        declared.push(...(manifest.provides ?? []).map(entry => entry.id))
      }
    }
    type Hook = (this: typeof ctx, ...args: unknown[]) => unknown

    await (plugin.buildStart as Hook).call(ctx)
    await (plugin.transform as Hook).call(ctx, code, consumer)
    await (plugin.generateBundle as Hook).call(ctx, {}, {})
    return declared
  }

  it('reads a typed service id from a package that exports its source', async () => {
    // What tsm#21 was, in both its halves: the constant lives in the API bundle,
    // and it is declared as serviceId<T>(...) rather than as a bare literal
    expect(await servicesOf(`
      import { component } from '@eclipse-daanse/tsm/decorators'
      import { WIDGET_SERVICE } from 'acme-api'
      @component({ service: [WIDGET_SERVICE] })
      export class Widget {}
    `)).toEqual(['acme.widget'])
  })

  it('picks the right constant out of several', async () => {
    expect(await servicesOf(`
      import { component } from '@eclipse-daanse/tsm/decorators'
      import { OTHER_SERVICE } from 'acme-api'
      @component({ service: [OTHER_SERVICE] })
      export class Other {}
    `)).toEqual(['acme.other'])
  })

  it('falls back to the source when a package resolves to built output', async () => {
    // dist/index.js does not exist yet, and a .d.ts would only carry the type —
    // the scan needs the value
    expect(await servicesOf(`
      import { component } from '@eclipse-daanse/tsm/decorators'
      import { BUILT_SERVICE } from 'built-api'
      @component({ service: [BUILT_SERVICE] })
      export class Built {}
    `)).toEqual(['acme.built'])
  })

  it('still reads a relative import', async () => {
    const { root: own, consumer: file } = await workspace()
    try {
      await writeFile(join(own, 'src', 'ids.ts'), `export const LOCAL = 'acme.local'`)
      const plugin = tsmPlugin({ components: 'derive', strict: false, manifest: { id: 'w' } })
      const declared: string[] = []
      const ctx = {
        error(message: string) { throw new Error(message) },
        warn() {},
        emitFile(f: { source: string }) {
          const manifest = JSON.parse(f.source) as { provides?: Array<{ id: string }> }
          declared.push(...(manifest.provides ?? []).map(entry => entry.id))
        }
      }
      type Hook = (this: typeof ctx, ...args: unknown[]) => unknown
      await (plugin.buildStart as Hook).call(ctx)
      await (plugin.transform as Hook).call(ctx, `
        import { component } from '@eclipse-daanse/tsm/decorators'
        import { LOCAL } from './ids.js'
        @component({ service: [LOCAL] })
        export class Local {}
      `, file)
      await (plugin.generateBundle as Hook).call(ctx, {}, {})

      expect(declared).toEqual(['acme.local'])
    } finally {
      await rm(own, { recursive: true, force: true })
    }
  })

  it('says so when a package cannot be resolved, rather than guessing', async () => {
    // An id that cannot be read is reported, not skipped: a manifest missing a
    // `provides` entry is a module nobody can find, and the build is the last
    // place to notice
    await expect(servicesOf(`
      import { component } from '@eclipse-daanse/tsm/decorators'
      import { NOWHERE } from 'not-installed-anywhere'
      @component({ service: [NOWHERE] })
      export class Nothing {}
    `)).rejects.toThrow('cannot be read at build time')
  })

  it('reads an id declared with as const', async () => {
    expect(await servicesOf(`
      import { component } from '@eclipse-daanse/tsm/decorators'
      import { CAST_SERVICE } from 'acme-api'
      @component({ service: [CAST_SERVICE] })
      export class Cast {}
    `)).toEqual(['acme.cast'])
  })

  it('reads an id declared with Symbol.for, whose key is the id', async () => {
    expect(await servicesOf(`
      import { component } from '@eclipse-daanse/tsm/decorators'
      import { SYMBOL_SERVICE } from 'acme-api'
      @component({ service: [SYMBOL_SERVICE] })
      export class Sym {}
    `)).toEqual(['acme.symbol'])
  })

  it('needs no resolver for a literal', () => {
    const [found] = extractComponents(`
      @component({ service: ['written.out'] })
      export class Plain {}
    `)
    expect(found.services.map(service => service.id)).toEqual(['written.out'])
  })
})
