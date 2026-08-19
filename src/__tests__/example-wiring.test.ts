import 'reflect-metadata'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ModuleLoader } from '../ModuleLoader'
import { DefaultServiceRegistry } from '../ServiceRegistry'
import { resolveWiring } from '../capabilities'
import { LOG_SERVICE, THEME_NAMESPACE, type Log } from '../../examples/wiring/src/contracts'
import { startup, variants } from '../../examples/wiring/src/manifests'
import * as editor from '../../examples/wiring/modules/editor'
import * as exporter from '../../examples/wiring/modules/exporter'
import * as gallery from '../../examples/wiring/modules/gallery'
import * as pdf from '../../examples/wiring/modules/pdf'
import * as preview from '../../examples/wiring/modules/preview'
import * as themeDark from '../../examples/wiring/modules/theme-dark'
import * as themeLight from '../../examples/wiring/modules/theme-light'
import * as workspace from '../../examples/wiring/modules/workspace'
import type { ModuleManifest } from '../types'

/**
 * The wiring example, asserted. Almost everything here needs no loader at all —
 * which is the example's point: resolution reads manifests.
 */
interface GlobalWithWindow { window?: Record<string, unknown> }
const globalRef = globalThis as GlobalWithWindow

function report(manifests: ModuleManifest[], moduleId: string) {
  return resolveWiring(manifests).requirements.filter(entry => entry.moduleId === moduleId)
}

describe('examples/wiring', () => {
  describe('without loading anything', () => {
    it('should wire the editor to the theme that satisfies filter and version', () => {
      const [requirement] = report(startup, 'editor')

      expect(requirement.wires.map(wire => wire.provider)).toEqual(['theme-dark'])
      expect(requirement.requirement.namespace).toBe(THEME_NAMESPACE)
    })

    it('should wire the gallery to every theme', () => {
      const [requirement] = report(startup, 'gallery')

      expect(requirement.wires.map(wire => wire.provider).sort())
        .toEqual(['theme-dark', 'theme-light'])
    })

    it('should derive a service requirement and wire it to the promise', () => {
      // preview declares requiresService, not a requirement — same model underneath
      const [requirement] = report(startup, 'preview')

      expect(requirement.wires.map(wire => wire.provider)).toEqual(['editor'])
    })

    it('should derive an identity requirement from a dependency', () => {
      const [requirement] = report(startup, 'workspace')

      expect(requirement.requirement.namespace).toBe('osgi.identity')
      expect(requirement.wires.map(wire => wire.provider)).toEqual(['editor'])
    })

    it('should tell waiting from waiting in vain', () => {
      const resolution = resolveWiring(startup)

      // Both wait for a service; only one waits for a promise that exists
      expect(resolution.resolved).toContain('preview')
      expect(resolution.resolved).not.toContain('exporter')
      expect(resolution.unresolved.map(entry => entry.moduleId)).toEqual(['exporter'])
    })

    it('should refuse the editor when the theme is downgraded below its range', () => {
      const downgraded = startup.map(manifest =>
        manifest.id === 'theme-dark' ? variants.themeDarkDowngraded : manifest
      )

      const [requirement] = report(downgraded, 'editor')
      expect(requirement.wires).toEqual([])
      expect(requirement.failure?.reason).toBe('no-match')
      expect(resolveWiring(downgraded).resolved).not.toContain('editor')
    })

    it('should leave the gallery with one theme when the other goes', () => {
      const fewer = startup.filter(manifest => manifest.id !== 'theme-light')

      const [requirement] = report(fewer, 'gallery')
      expect(requirement.wires.map(wire => wire.provider)).toEqual(['theme-dark'])
      // Still resolvable: multiple does not mean "at least two"
      expect(resolveWiring(fewer).resolved).toContain('gallery')
    })

    it('should make the exporter resolvable once somebody promises the service', () => {
      const withPdf = [...startup, variants.pdfProvider]

      expect(resolveWiring(withPdf).unresolved).toEqual([])
      expect(report(withPdf, 'exporter')[0].wires.map(wire => wire.provider)).toEqual(['pdf'])
    })
  })

  describe('and then loading', () => {
    let savedWindow: Record<string, unknown> | undefined
    let reported: string[]
    let loader: ModuleLoader

    beforeEach(() => {
      savedWindow = globalRef.window
      globalRef.window = {
        'theme-dark': themeDark,
        'theme-light': themeLight,
        editor,
        gallery,
        preview,
        exporter,
        workspace,
        pdf
      }
      reported = []
      const services = new DefaultServiceRegistry()
      loader = new ModuleLoader({ serviceRegistry: services })
      const log: Log = { write: (source, message) => reported.push(`${source}: ${message}`) }
      services.register(LOG_SERVICE, log, { providedBy: 'host' })
    })

    afterEach(() => {
      globalRef.window = savedWindow
    })

    it('should run everything that resolves', async () => {
      const resolution = resolveWiring(startup)
      loader.register(startup.filter(manifest => resolution.resolved.includes(manifest.id)))

      await loader.loadAll()

      expect(loader.getLoadedModuleIds().sort()).toEqual(
        ['editor', 'gallery', 'preview', 'theme-dark', 'theme-light', 'workspace']
      )
      expect(reported).toContain('editor: registered demo.editor')
    })

    it('should never fetch a module that cannot resolve', async () => {
      const resolution = resolveWiring(startup)
      loader.register(startup.filter(manifest => resolution.resolved.includes(manifest.id)))

      await loader.loadAll()

      // Not parked — never asked for. The resolution knew before anything loaded.
      expect(loader.getModule('exporter')).toBeUndefined()
      expect(reported.some(entry => entry.startsWith('exporter'))).toBe(false)
    })

    it('should agree with the loader about what is unresolvable', async () => {
      loader.register(startup)

      // Registering everything, including the unresolvable one: the loader says
      // the same thing the resolution did
      expect(loader.getUnresolvedModules().map(entry => entry.moduleId)).toEqual(['exporter'])
    })
  })
})
