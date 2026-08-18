import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ConfigurationAdmin,
  MemoryConfigurationStore,
  type ConfigurationEvent,
  type ConfigurationRecord,
  type ConfigurationStore
} from '../ConfigurationAdmin'

describe('ConfigurationAdmin', () => {
  let admin: ConfigurationAdmin
  let events: ConfigurationEvent[]

  beforeEach(() => {
    admin = new ConfigurationAdmin()
    events = []
    admin.addListener({ onConfigurationEvent: event => events.push(event) })
  })

  describe('getConfiguration', () => {
    it('should create the configuration empty, as OSGi does', () => {
      const config = admin.getConfiguration('demo.tiles')

      expect(config.pid).toBe('demo.tiles')
      expect(config.getProperties()).toBeUndefined()
      expect(config.changeCount).toBe(0)
    })

    it('should return the same configuration for a PID', async () => {
      await admin.getConfiguration('demo.tiles').update({ url: 'a' })

      expect(admin.getConfiguration('demo.tiles').getProperties()).toMatchObject({ url: 'a' })
    })

    it('should not deliver a configuration that has no values', () => {
      admin.getConfiguration('demo.tiles')

      expect(events).toEqual([])
      expect(admin.listConfigurations()).toEqual([])
    })

    it('should find an existing configuration only', async () => {
      await admin.getConfiguration('demo.tiles').update({ url: 'a' })

      expect(admin.findConfiguration('demo.tiles')).toBeDefined()
      expect(admin.findConfiguration('demo.other')).toBeUndefined()
    })
  })

  describe('update', () => {
    it('should store the values and count the change', async () => {
      const config = admin.getConfiguration('demo.tiles')

      await config.update({ url: 'https://tiles/{z}', retina: true })

      expect(config.getProperties()).toMatchObject({ url: 'https://tiles/{z}', retina: true })
      expect(config.changeCount).toBe(1)
    })

    it('should add service.pid, as Config Admin does', async () => {
      const config = admin.getConfiguration('demo.tiles')

      await config.update({ url: 'a' })

      expect(config.getProperties()?.['service.pid']).toBe('demo.tiles')
    })

    it('should emit an updated event', async () => {
      await admin.getConfiguration('demo.tiles').update({ url: 'a' })

      expect(events).toEqual([{ type: 'updated', pid: 'demo.tiles', factoryPid: undefined }])
    })

    it('should hand out a copy, so a change needs an update', async () => {
      const config = admin.getConfiguration('demo.tiles')
      await config.update({ url: 'a' })

      const properties = config.getProperties()
      properties!.url = 'tampered'

      expect(config.getProperties()?.url).toBe('a')
    })

    it('should re-deliver without arguments', async () => {
      const config = admin.getConfiguration('demo.tiles')
      await config.update({ url: 'a' })
      events.length = 0

      await config.update()

      expect(events).toHaveLength(1)
      expect(config.getProperties()).toMatchObject({ url: 'a' })
      expect(config.changeCount).toBe(2)
    })

    it('should refuse a re-delivery of nothing', async () => {
      await expect(admin.getConfiguration('demo.tiles').update()).rejects.toThrow(
        /no properties to re-deliver/
      )
    })

    it('should update only on a difference', async () => {
      const config = admin.getConfiguration('demo.tiles')
      await config.update({ url: 'a', layers: ['road', 'sat'] })

      expect(await config.updateIfDifferent({ url: 'a', layers: ['road', 'sat'] })).toBe(false)
      expect(await config.updateIfDifferent({ url: 'a', layers: ['road'] })).toBe(true)
      expect(config.changeCount).toBe(2)
    })
  })

  describe('value types', () => {
    it('should accept strings, numbers, booleans and arrays of those', async () => {
      const config = admin.getConfiguration('demo.tiles')

      await config.update({ url: 'a', zoom: 12, retina: false, layers: ['road', 'sat'] })

      expect(config.changeCount).toBe(1)
    })

    it('should reject a value a filter could not match', async () => {
      const config = admin.getConfiguration('demo.tiles')

      // A nested object cannot be filtered on, and localStorage would flatten it
      await expect(
        config.update({ nested: { url: 'a' } } as never)
      ).rejects.toThrow(/only strings, numbers, booleans/)
    })

    it('should name null as such rather than as object', async () => {
      await expect(
        admin.getConfiguration('demo.tiles').update({ url: null } as never)
      ).rejects.toThrow(/is null/)
    })

    it('should reject two keys differing only in case', async () => {
      await expect(
        admin.getConfiguration('demo.tiles').update({ url: 'a', URL: 'b' })
      ).rejects.toThrow(/differ only in case/)
    })
  })

  describe('delete', () => {
    it('should remove the configuration and say so', async () => {
      const config = admin.getConfiguration('demo.tiles')
      await config.update({ url: 'a' })
      events.length = 0

      await config.delete()

      expect(admin.findConfiguration('demo.tiles')).toBeUndefined()
      expect(events).toEqual([{ type: 'deleted', pid: 'demo.tiles', factoryPid: undefined }])
    })

    it('should refuse further use of a deleted configuration', async () => {
      const config = admin.getConfiguration('demo.tiles')
      await config.update({ url: 'a' })
      await config.delete()

      expect(config.getProperties()).toBeUndefined()
      await expect(config.update({ url: 'b' })).rejects.toThrow(/has been deleted/)
    })
  })

  describe('listConfigurations', () => {
    beforeEach(async () => {
      await admin.getConfiguration('demo.tiles').update({ kind: 'raster', zoom: 12 })
      await admin.getConfiguration('demo.routing').update({ kind: 'graph' })
      admin.getConfiguration('demo.never-configured')
    })

    it('should list what has values', () => {
      expect(admin.listConfigurations().map(config => config.pid).sort())
        .toEqual(['demo.routing', 'demo.tiles'])
    })

    it('should narrow by an LDAP filter over the properties', () => {
      expect(admin.listConfigurations('(kind=raster)').map(config => config.pid))
        .toEqual(['demo.tiles'])
      expect(admin.listConfigurations('(zoom>=10)').map(config => config.pid))
        .toEqual(['demo.tiles'])
    })

    it('should filter on service.pid too', () => {
      expect(admin.listConfigurations('(service.pid=demo.routing)').map(config => config.pid))
        .toEqual(['demo.routing'])
    })

    it('should return an empty array rather than null when nothing matches', () => {
      expect(admin.listConfigurations('(kind=vector)')).toEqual([])
    })
  })

  describe('factory configurations', () => {
    it('should build the PID as factoryPid~name', () => {
      const config = admin.getFactoryConfiguration('demo.tile-source', 'osm')

      expect(config.pid).toBe('demo.tile-source~osm')
      expect(config.factoryPid).toBe('demo.tile-source')
    })

    it('should carry service.factoryPid', async () => {
      const config = admin.getFactoryConfiguration('demo.tile-source', 'osm')

      await config.update({ url: 'a' })

      expect(config.getProperties()?.['service.factoryPid']).toBe('demo.tile-source')
    })

    it('should generate a name when none is given', async () => {
      const first = admin.createFactoryConfiguration('demo.tile-source')
      const second = admin.createFactoryConfiguration('demo.tile-source')
      await first.update({ url: 'a' })
      await second.update({ url: 'b' })

      expect(first.pid).not.toBe(second.pid)
      expect(admin.listFactoryConfigurations('demo.tile-source')).toHaveLength(2)
    })

    it('should not collide with a name that is already taken', async () => {
      await admin.getFactoryConfiguration('demo.tile-source', '1').update({ url: 'a' })

      const generated = admin.createFactoryConfiguration('demo.tile-source')

      expect(generated.pid).not.toBe('demo.tile-source~1')
    })

    it('should refuse an empty name', () => {
      expect(() => admin.getFactoryConfiguration('demo.tile-source', '')).toThrow(/needs a name/)
    })

    it('should list only the configurations of that factory', async () => {
      await admin.getFactoryConfiguration('demo.tile-source', 'osm').update({ url: 'a' })
      await admin.getFactoryConfiguration('demo.other', 'x').update({ url: 'b' })

      expect(admin.listFactoryConfigurations('demo.tile-source').map(config => config.pid))
        .toEqual(['demo.tile-source~osm'])
    })
  })

  describe('store', () => {
    it('should persist an update', async () => {
      const store = new MemoryConfigurationStore()
      const persisting = new ConfigurationAdmin({ store })

      await persisting.getConfiguration('demo.tiles').update({ url: 'a' })

      expect(store.load()).toEqual([
        { pid: 'demo.tiles', factoryPid: undefined, properties: { url: 'a' }, changeCount: 1 }
      ])
    })

    it('should remove a deleted configuration from the store', async () => {
      const store = new MemoryConfigurationStore()
      const persisting = new ConfigurationAdmin({ store })
      const config = persisting.getConfiguration('demo.tiles')
      await config.update({ url: 'a' })

      await config.delete()

      expect(store.load()).toEqual([])
    })

    it('should load what the store holds', async () => {
      const store = new MemoryConfigurationStore([
        { pid: 'demo.tiles', properties: { url: 'stored' }, changeCount: 3 }
      ])
      const restored = new ConfigurationAdmin({ store })

      await restored.ready()

      const config = restored.findConfiguration('demo.tiles')
      expect(config?.getProperties()).toMatchObject({ url: 'stored' })
      expect(config?.changeCount).toBe(3)
    })

    it('should announce loaded configurations, so a waiting component starts', async () => {
      const store = new MemoryConfigurationStore([
        { pid: 'demo.tiles', properties: { url: 'stored' }, changeCount: 1 }
      ])
      const restored = new ConfigurationAdmin({ store })
      const seen: ConfigurationEvent[] = []
      restored.addListener({ onConfigurationEvent: event => seen.push(event) })

      await restored.ready()

      expect(seen).toEqual([{ type: 'updated', pid: 'demo.tiles', factoryPid: undefined }])
    })

    it('should let a configuration made in the meantime win over the stored one', async () => {
      let release = (): void => {}
      const slow: ConfigurationStore = {
        load: () => new Promise<ConfigurationRecord[]>(resolve => {
          release = () => resolve([
            { pid: 'demo.tiles', properties: { url: 'stored' }, changeCount: 1 }
          ])
        }),
        save: () => {},
        remove: () => {}
      }
      const racing = new ConfigurationAdmin({ store: slow })

      await racing.getConfiguration('demo.tiles').update({ url: 'newer' })
      release()
      await racing.ready()

      expect(racing.findConfiguration('demo.tiles')?.getProperties()).toMatchObject({
        url: 'newer'
      })
    })

    it('should await an asynchronous save', async () => {
      const saved: ConfigurationRecord[] = []
      const asyncStore: ConfigurationStore = {
        load: async () => [],
        save: async record => {
          await Promise.resolve()
          saved.push(record)
        },
        remove: async () => {}
      }
      const persisting = new ConfigurationAdmin({ store: asyncStore })

      await persisting.getConfiguration('demo.tiles').update({ url: 'a' })

      expect(saved).toHaveLength(1)
    })
  })

  describe('listeners', () => {
    it('should keep notifying after one listener throws', async () => {
      const good = vi.fn()
      admin.addListener({ onConfigurationEvent: () => { throw new Error('boom') } })
      admin.addListener({ onConfigurationEvent: good })

      await admin.getConfiguration('demo.tiles').update({ url: 'a' })

      expect(good).toHaveBeenCalledTimes(1)
    })

    it('should stop notifying a removed listener', async () => {
      const listener = { onConfigurationEvent: vi.fn() }
      admin.addListener(listener)

      admin.removeListener(listener)
      await admin.getConfiguration('demo.tiles').update({ url: 'a' })

      expect(listener.onConfigurationEvent).not.toHaveBeenCalled()
    })
  })
})
