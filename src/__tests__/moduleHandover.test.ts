import 'reflect-metadata'
import { describe, it, expect, vi } from 'vitest'
import { ModuleLoader } from '../ModuleLoader'
import { activate, component } from '../decorators'
import type { ModuleContext, ModuleManifest } from '../types'

/**
 * Handing a module to the loader.
 *
 * There is no global involved. A module used to arrive through
 * `window[moduleId]` — the Module Federation convention — which cost collisions
 * with DOM ids (the browser exposes every element id as a global) and made the
 * loader unusable in Node, where `window` does not exist at all. These tests run
 * in plain Node, which is the proof.
 */
function manifest(id: string, extra: Partial<ModuleManifest> = {}): ModuleManifest {
  return {
    id,
    name: id,
    version: '1.0.0',
    // A URL that would fail if anything tried to fetch it
    entry: `http://127.0.0.1:1/${id}.js`,
    exports: {},
    ...extra
  }
}

describe('handing over a module', () => {
  it('should run without any window at all', async () => {
    // The environment this suite runs in: no window, and none is faked
    expect((globalThis as { window?: unknown }).window).toBeUndefined()

    const started = vi.fn()
    const loader = new ModuleLoader()

    const loaded = await loader.loadModule(manifest('plain'), {
      container: { activate: () => { started() } }
    })

    expect(loaded.state).toBe('active')
    expect(started).toHaveBeenCalled()
  })

  it('should never fetch the entry when a container is given', async () => {
    const loader = new ModuleLoader()

    // The entry points at a closed port; reaching it would throw
    const loaded = await loader.loadModule(manifest('plain'), { container: {} })

    expect(loaded.state).toBe('active')
  })

  it('should start the components of a handed-over module', async () => {
    @component({ service: ['demo.thing'] })
    class Thing {
      @activate() start(): void {}
    }

    const loader = new ModuleLoader()
    await loader.loadModule(manifest('mod'), { container: { Thing } })

    // Full loader semantics, not a special case: components, services, lifecycle
    expect(loader.getServiceRegistry().has('demo.thing')).toBe(true)
    expect(loader.getComponents('mod').map(entry => entry.className)).toEqual(['Thing'])
  })

  it('should pass the module context to a handed-over activate', async () => {
    let seen: string | undefined
    const loader = new ModuleLoader()

    await loader.loadModule(manifest('ctx'), {
      container: {
        activate: (context: ModuleContext) => { seen = context.manifest.id }
      }
    })

    expect(seen).toBe('ctx')
  })

  it('should reject something that cannot be a namespace', async () => {
    const loader = new ModuleLoader()

    await expect(loader.loadModule(manifest('bad'), { container: 42 }))
      .rejects.toThrow(/expected a module namespace/)
  })

  it('should say so rather than quietly falling back to the URL', async () => {
    const loader = new ModuleLoader()

    // Silently fetching instead would hide the mistake behind a network error
    await expect(loader.loadModule(manifest('bad'), { container: null }))
      .rejects.toThrow(/is null/)
  })
})

describe('entryResolver', () => {
  it('should answer for every module the loader asks about', async () => {
    const preloaded: Record<string, unknown> = {
      first: { activate: () => {} },
      second: { activate: () => {} }
    }
    const loader = new ModuleLoader({
      entryResolver: manifestToLoad => preloaded[manifestToLoad.id]
    })
    loader.register([manifest('first'), manifest('second')])

    await loader.loadAll()

    expect(loader.getLoadedModuleIds().sort()).toEqual(['first', 'second'])
  })

  it('should fall through to the URL when it answers undefined', async () => {
    const loader = new ModuleLoader({ entryResolver: () => undefined })

    // Nothing preloaded, so the unreachable entry is what is left
    await expect(loader.loadModule(manifest('remote')))
      .rejects.toThrow(/Failed to load module entry/)
  })

  it('should be consulted after an explicit container', async () => {
    const resolved = vi.fn(() => ({ activate: () => {} }))
    const loader = new ModuleLoader({ entryResolver: resolved })

    await loader.loadModule(manifest('mod'), { container: { activate: () => {} } })

    expect(resolved).not.toHaveBeenCalled()
  })

  it('should receive the manifest, not just the id', async () => {
    const seen: string[] = []
    const loader = new ModuleLoader({
      entryResolver: manifestToLoad => {
        seen.push(`${manifestToLoad.id}@${manifestToLoad.version}`)
        return { activate: () => {} }
      }
    })

    await loader.loadModule(manifest('mod', { version: '2.3.4' }))

    expect(seen).toEqual(['mod@2.3.4'])
  })
})

describe('a handed-over module through its lifecycle', () => {
  it('should reload without a URL to fetch', async () => {
    const events: string[] = []
    const loader = new ModuleLoader({ hotReload: true })

    await loader.loadModule(manifest('mod'), {
      container: {
        activate: () => { events.push('activate') },
        deactivate: () => { events.push('deactivate') }
      }
    })

    // The container is remembered, so this restarts the module rather than
    // failing on an entry nobody can fetch
    await loader.reloadModule('mod')

    expect(events).toEqual(['activate', 'deactivate', 'activate'])
    expect(loader.getModule('mod')?.state).toBe('active')
  })

  it('should let go of the container when the module is unloaded', async () => {
    const loader = new ModuleLoader()
    await loader.loadModule(manifest('mod'), { container: { activate: () => {} } })

    await loader.unloadModule('mod')

    // Not remembered any more: loading again has to be told what to run, and the
    // module object is no longer held alive
    await expect(loader.loadModule(manifest('mod')))
      .rejects.toThrow(/Failed to load module entry/)
  })
})

describe('the URL path, in Node', () => {
  it('should import a data URL, which needs no browser at all', async () => {
    const loader = new ModuleLoader()
    const ran: string[] = []
    ;(globalThis as { __handoverProbe?: () => void }).__handoverProbe = () => ran.push('ran')

    // Node's ESM loader takes file: and data:. So the URL path is not
    // browser-only either — what made the loader browser-only was `window`.
    const loaded = await loader.loadModule({
      id: 'inline',
      name: 'inline',
      version: '1.0.0',
      entry: 'data:text/javascript,export const activate = () => globalThis.__handoverProbe()',
      exports: {}
    })

    expect(loaded.state).toBe('active')
    expect(ran).toEqual(['ran'])
    delete (globalThis as { __handoverProbe?: () => void }).__handoverProbe
  })

  it('should add a cache buster when reloading a module that has a URL', async () => {
    const loader = new ModuleLoader({ hotReload: true })
    const manifestWithUrl: ModuleManifest = {
      id: 'inline',
      name: 'inline',
      version: '1.0.0',
      entry: 'data:text/javascript,export const activate = () => {}',
      exports: {}
    }
    await loader.loadModule(manifestWithUrl)

    await loader.reloadModule('inline')

    // What a module fetched over HTTP needs, and what a handed-over one must not
    // get — there the manifest would then claim a URL nobody uses
    expect(manifestWithUrl.entry).toContain('?t=')
  })
})
