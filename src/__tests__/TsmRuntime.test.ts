import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tsmRuntime, initTsmRuntime, isTsmRuntimeAvailable } from '../TsmRuntime'

/**
 * The runtime keeps its libraries in module scope, so there is no reset between
 * tests. Each test therefore uses its own library IDs.
 */
let counter = 0
function uniqueId(prefix = 'lib'): string {
  counter += 1
  return `${prefix}-${counter}`
}

describe('tsmRuntime', () => {
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('register and require', () => {
    it('should hand back what was registered', () => {
      const id = uniqueId()
      const exports = { createApp: () => {} }

      tsmRuntime.register(id, exports, '3.4.0')

      expect(tsmRuntime.require(id)).toBe(exports)
      expect(tsmRuntime.has(id)).toBe(true)
      expect(tsmRuntime.getVersion(id)).toBe('3.4.0')
    })

    it('should name the available libraries when one is missing', () => {
      const id = uniqueId('present')
      tsmRuntime.register(id, {}, '1.0.0')

      expect(() => tsmRuntime.require('nowhere')).toThrow(/Shared library not found: 'nowhere'/)
      // The message is a build-time debugging aid, so it lists what is there
      expect(() => tsmRuntime.require('nowhere')).toThrow(new RegExp(id))
    })

    it('should reject a version that is not semver', () => {
      expect(() => tsmRuntime.register(uniqueId(), {}, 'latest')).toThrow(
        /Invalid version 'latest'/
      )
      expect(() => tsmRuntime.register(uniqueId(), {}, '3.4')).toThrow(/Invalid version/)
    })

    it('should accept a prerelease version', () => {
      const id = uniqueId()

      tsmRuntime.register(id, {}, '3.4.0-beta.1')

      expect(tsmRuntime.getVersion(id)).toBe('3.4.0-beta.1')
    })

    it('should warn when overwriting a library', () => {
      const id = uniqueId()
      tsmRuntime.register(id, { v: 1 }, '1.0.0')

      tsmRuntime.register(id, { v: 2 }, '2.0.0')

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining(`Overwriting shared library '${id}'`)
      )
      expect(tsmRuntime.require(id)).toEqual({ v: 2 })
      expect(tsmRuntime.getVersion(id)).toBe('2.0.0')
    })

    it('should record who provided a library', () => {
      const id = uniqueId()

      tsmRuntime.register(id, {}, '1.0.0', 'host-app')

      expect(tsmRuntime.getRegistered().get(id)).toEqual({
        version: '1.0.0',
        providedBy: 'host-app'
      })
    })

    it('should report nothing for an unknown library', () => {
      expect(tsmRuntime.has('unknown')).toBe(false)
      expect(tsmRuntime.getVersion('unknown')).toBeUndefined()
      expect(tsmRuntime.satisfies('unknown', '^1.0.0')).toBe(false)
    })
  })

  describe('satisfies', () => {
    it('should check the registered version against a range', () => {
      const id = uniqueId()
      tsmRuntime.register(id, {}, '3.4.2')

      expect(tsmRuntime.satisfies(id, '^3.0.0')).toBe(true)
      expect(tsmRuntime.satisfies(id, '~3.4.0')).toBe(true)
      expect(tsmRuntime.satisfies(id, '>=4.0.0')).toBe(false)
      expect(tsmRuntime.satisfies(id, '2.x')).toBe(false)
    })
  })

  describe('validate', () => {
    it('should pass when every requirement is met', () => {
      const vue = uniqueId('vue')
      const router = uniqueId('router')
      tsmRuntime.register(vue, {}, '3.4.0')
      tsmRuntime.register(router, {}, '4.2.0')

      expect(tsmRuntime.validate([
        { id: vue, versionRange: '^3.0.0' },
        { id: router, versionRange: '^4.0.0' }
      ])).toEqual({ valid: true, missing: [], incompatible: [] })
    })

    it('should report a missing library', () => {
      const result = tsmRuntime.validate([{ id: 'absent', versionRange: '^1.0.0' }])

      expect(result.valid).toBe(false)
      expect(result.missing).toEqual(['absent'])
      expect(result.incompatible).toEqual([])
    })

    it('should report an incompatible version with both sides', () => {
      const id = uniqueId()
      tsmRuntime.register(id, {}, '2.1.0')

      const result = tsmRuntime.validate([{ id, versionRange: '^3.0.0' }])

      expect(result.valid).toBe(false)
      expect(result.missing).toEqual([])
      expect(result.incompatible).toEqual([
        { id, required: '^3.0.0', available: '2.1.0' }
      ])
    })

    it('should collect several problems at once', () => {
      const id = uniqueId()
      tsmRuntime.register(id, {}, '1.0.0')

      const result = tsmRuntime.validate([
        { id, versionRange: '^2.0.0' },
        { id: 'gone', versionRange: '^1.0.0' }
      ])

      expect(result.missing).toEqual(['gone'])
      expect(result.incompatible).toHaveLength(1)
    })

    it('should be valid for an empty requirement list', () => {
      expect(tsmRuntime.validate([])).toEqual({ valid: true, missing: [], incompatible: [] })
    })
  })

  describe('global installation', () => {
    interface GlobalWithWindow { window?: Record<string, unknown> }
    const globalRef = globalThis as GlobalWithWindow
    let savedWindow: Record<string, unknown> | undefined

    beforeEach(() => {
      savedWindow = globalRef.window
    })

    afterEach(() => {
      globalRef.window = savedWindow
    })

    it('should report unavailable without a window', () => {
      delete globalRef.window

      expect(isTsmRuntimeAvailable()).toBe(false)
      // Still usable directly, which is what the tests above rely on
      expect(initTsmRuntime()).toBe(tsmRuntime)
    })

    it('should install itself on window', () => {
      globalRef.window = {}

      const installed = initTsmRuntime()

      expect(installed).toBe(tsmRuntime)
      expect(globalRef.window.__tsm__).toBe(tsmRuntime)
      expect(isTsmRuntimeAvailable()).toBe(true)
    })

    it('should keep an existing runtime instead of replacing it', () => {
      const existing = { require: () => undefined }
      globalRef.window = { __tsm__: existing }

      const returned = initTsmRuntime()

      expect(returned).toBe(existing)
      expect(globalRef.window.__tsm__).toBe(existing)
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Runtime already initialized')
      )
    })
  })
})
