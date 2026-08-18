// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { ConfigurationAdmin, LocalStorageConfigurationStore } from '../ConfigurationAdmin'

describe('LocalStorageConfigurationStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('should write one entry per PID', async () => {
    const store = new LocalStorageConfigurationStore()
    const admin = new ConfigurationAdmin({ store })

    await admin.getConfiguration('demo.tiles').update({ url: 'a' })
    await admin.getConfiguration('demo.routing').update({ mode: 'car' })

    expect(localStorage.getItem('tsm.config.demo.tiles')).toContain('"url":"a"')
    expect(localStorage.getItem('tsm.config.demo.routing')).toContain('"mode":"car"')
  })

  it('should survive a restart', async () => {
    await new ConfigurationAdmin({ store: new LocalStorageConfigurationStore() })
      .getConfiguration('demo.tiles')
      .update({ url: 'a', zoom: 12 })

    const restarted = new ConfigurationAdmin({ store: new LocalStorageConfigurationStore() })
    await restarted.ready()

    expect(restarted.findConfiguration('demo.tiles')?.getProperties())
      .toMatchObject({ url: 'a', zoom: 12 })
  })

  it('should remove the entry of a deleted configuration', async () => {
    const admin = new ConfigurationAdmin({ store: new LocalStorageConfigurationStore() })
    const config = admin.getConfiguration('demo.tiles')
    await config.update({ url: 'a' })

    await config.delete()

    expect(localStorage.getItem('tsm.config.demo.tiles')).toBeNull()
  })

  it('should ignore foreign keys and its own unreadable ones', async () => {
    localStorage.setItem('unrelated', 'not json')
    localStorage.setItem('tsm.config.broken', '{ this is not json')
    const admin = new ConfigurationAdmin({ store: new LocalStorageConfigurationStore() })

    await admin.ready()

    expect(admin.listConfigurations()).toEqual([])
  })

  it('should honour a custom prefix, so two apps can share a domain', async () => {
    const admin = new ConfigurationAdmin({
      store: new LocalStorageConfigurationStore('workbench.')
    })

    await admin.getConfiguration('demo.tiles').update({ url: 'a' })

    expect(localStorage.getItem('workbench.demo.tiles')).not.toBeNull()
    expect(localStorage.getItem('tsm.config.demo.tiles')).toBeNull()
  })
})
