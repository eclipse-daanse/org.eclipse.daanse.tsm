/**
 * Targeted PIDs (Configuration Admin 104.3.2).
 *
 * A PID that names who it is for: `demo.tiles|map-plugin|2.1.0` configures that
 * PID only for that version of that module. What it buys is a rollout — the new
 * version gets its own configuration while the old one keeps running.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ConfigurationAdmin, targetedPids } from '../ConfigurationAdmin.js'
import { ModuleLoader } from '../ModuleLoader.js'
import { component, activate, modified } from '../decorators.js'
import type { ComponentContext, ModuleManifest } from '../types.js'

describe('targetedPids()', () => {
  it('is just the PID without a target', () => {
    expect(targetedPids('demo.tiles')).toEqual(['demo.tiles'])
  })

  it('puts the version-specific form first', () => {
    expect(targetedPids('demo.tiles', { id: 'map', version: '2.1.0' })).toEqual([
      'demo.tiles|map|2.1.0',
      'demo.tiles|map',
      'demo.tiles'
    ])
  })

  it('leaves out the version segment when there is none', () => {
    expect(targetedPids('demo.tiles', { id: 'map' })).toEqual([
      'demo.tiles|map',
      'demo.tiles'
    ])
  })
})

describe('the lookup chain', () => {
  let admin: ConfigurationAdmin

  beforeEach(() => {
    admin = new ConfigurationAdmin()
  })

  const target = { id: 'map', version: '2.1.0' }

  it('finds the plain PID when nothing is targeted', async () => {
    await admin.getConfiguration('demo.tiles').update({ zoom: 1 })
    expect(admin.findTargetedConfiguration('demo.tiles', target)?.getProperties()?.zoom).toBe(1)
  })

  it('prefers the module-specific configuration', async () => {
    await admin.getConfiguration('demo.tiles').update({ zoom: 1 })
    await admin.getConfiguration('demo.tiles|map').update({ zoom: 2 })

    expect(admin.findTargetedConfiguration('demo.tiles', target)?.getProperties()?.zoom).toBe(2)
  })

  it('prefers the version-specific one over the module-specific one', async () => {
    await admin.getConfiguration('demo.tiles').update({ zoom: 1 })
    await admin.getConfiguration('demo.tiles|map').update({ zoom: 2 })
    await admin.getConfiguration('demo.tiles|map|2.1.0').update({ zoom: 3 })

    expect(admin.findTargetedConfiguration('demo.tiles', target)?.getProperties()?.zoom).toBe(3)
  })

  it('ignores a configuration targeted at another module', async () => {
    await admin.getConfiguration('demo.tiles').update({ zoom: 1 })
    await admin.getConfiguration('demo.tiles|other').update({ zoom: 9 })

    expect(admin.findTargetedConfiguration('demo.tiles', target)?.getProperties()?.zoom).toBe(1)
  })

  it('ignores a configuration targeted at another version', async () => {
    await admin.getConfiguration('demo.tiles').update({ zoom: 1 })
    await admin.getConfiguration('demo.tiles|map|1.0.0').update({ zoom: 9 })

    expect(admin.findTargetedConfiguration('demo.tiles', target)?.getProperties()?.zoom).toBe(1)
  })

  it('does not let an empty targeted entry shadow a real configuration', async () => {
    await admin.getConfiguration('demo.tiles').update({ zoom: 1 })
    // getConfiguration() creates the entry without values, as OSGi does. Ending
    // the search there would leave the component unconfigured because a UI once
    // looked at the targeted PID
    admin.getConfiguration('demo.tiles|map|2.1.0')

    expect(admin.findTargetedConfiguration('demo.tiles', target)?.getProperties()?.zoom).toBe(1)
  })

  it('reports the PID that actually answered', async () => {
    await admin.getConfiguration('demo.tiles|map').update({ zoom: 2 })
    expect(admin.findTargetedConfiguration('demo.tiles', target)?.pid).toBe('demo.tiles|map')
  })

  it('is findConfiguration without a target', async () => {
    await admin.getConfiguration('demo.tiles|map').update({ zoom: 2 })
    expect(admin.findTargetedConfiguration('demo.tiles')).toBeUndefined()
  })

  describe('factory configurations', () => {
    it('follows the chain', async () => {
      await admin.getFactoryConfiguration('demo.tile', 'a').update({ n: 1 })
      await admin.getFactoryConfiguration('demo.tile|map', 'b').update({ n: 2 })

      const found = admin.listTargetedFactoryConfigurations('demo.tile', target)
      expect(found.map(c => c.getProperties()?.n)).toEqual([2])
    })

    it('replaces the less specific set rather than adding to it', async () => {
      // A merge would give the module instances it was targeted away from
      await admin.getFactoryConfiguration('demo.tile', 'a').update({ n: 1 })
      await admin.getFactoryConfiguration('demo.tile', 'b').update({ n: 2 })
      await admin.getFactoryConfiguration('demo.tile|map|2.1.0', 'c').update({ n: 3 })

      const found = admin.listTargetedFactoryConfigurations('demo.tile', target)
      expect(found.map(c => c.getProperties()?.n)).toEqual([3])
    })

    it('falls through to the plain factory PID', async () => {
      await admin.getFactoryConfiguration('demo.tile', 'a').update({ n: 1 })
      const found = admin.listTargetedFactoryConfigurations('demo.tile', target)
      expect(found.map(c => c.getProperties()?.n)).toEqual([1])
    })
  })
})

describe('a component reading a targeted configuration', () => {
  let loader: ModuleLoader
  let admin: ConfigurationAdmin

  const manifest = (version: string): ModuleManifest => ({
    id: 'map',
    version,
    entry: 'map.js',
    provides: []
  })

  beforeEach(() => {
    admin = new ConfigurationAdmin()
    loader = new ModuleLoader({ configurationAdmin: admin })
  })

  /** Only the value under test: the configuration also carries `service.pid` */
  const zooms = (seen: Array<Record<string, unknown>>): unknown[] =>
    seen.map(configuration => configuration.zoom)

  const componentModule = (seen: Array<Record<string, unknown>>) => {
    @component({ configurationPid: 'demo.tiles' })
    class Tiles {
      @activate()
      start(context: ComponentContext): void { seen.push(context.configuration) }

      @modified()
      changed(context: ComponentContext): void { seen.push(context.configuration) }
    }
    return { Tiles }
  }

  it('reads the configuration targeted at its version', async () => {
    await admin.getConfiguration('demo.tiles').update({ zoom: 1 })
    await admin.getConfiguration('demo.tiles|map|2.1.0').update({ zoom: 3 })

    const seen: Array<Record<string, unknown>> = []
    await loader.loadModule(manifest('2.1.0'), { container: componentModule(seen) })

    expect(zooms(seen)).toEqual([3])
  })

  it('leaves another version on the plain configuration', async () => {
    await admin.getConfiguration('demo.tiles').update({ zoom: 1 })
    await admin.getConfiguration('demo.tiles|map|2.1.0').update({ zoom: 3 })

    const seen: Array<Record<string, unknown>> = []
    await loader.loadModule(manifest('1.0.0'), { container: componentModule(seen) })

    expect(zooms(seen)).toEqual([1])
  })

  it('reacts when a targeted configuration is written while it runs', async () => {
    await admin.getConfiguration('demo.tiles').update({ zoom: 1 })

    const seen: Array<Record<string, unknown>> = []
    await loader.loadModule(manifest('2.1.0'), { container: componentModule(seen) })
    expect(zooms(seen)).toEqual([1])

    // Without the targeted forms in `affects()` this change would go unnoticed:
    // the component would keep running on the untargeted values
    await admin.getConfiguration('demo.tiles|map').update({ zoom: 7 })
    await loader.settle()

    expect(zooms(seen)).toEqual([1, 7])
  })

  it('ignores a configuration targeted at another module', async () => {
    await admin.getConfiguration('demo.tiles').update({ zoom: 1 })

    const seen: Array<Record<string, unknown>> = []
    await loader.loadModule(manifest('2.1.0'), { container: componentModule(seen) })

    await admin.getConfiguration('demo.tiles|other').update({ zoom: 9 })
    await loader.settle()

    expect(zooms(seen)).toEqual([1])
  })

  it('tells the component which PID configured it', async () => {
    await admin.getConfiguration('demo.tiles|map').update({ zoom: 2 })

    let pid: string | undefined
    @component({ configurationPid: 'demo.tiles' })
    class Tiles {
      @activate()
      start(context: ComponentContext): void { pid = context.configurationPid }
    }

    await loader.loadModule(manifest('2.1.0'), { container: { Tiles } })
    expect(pid).toBe('demo.tiles|map')
  })
})
