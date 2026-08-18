import { describe, it, expect, beforeEach } from 'vitest'
import { MetatypeRegistry, objectClass } from '../Metatype'

describe('Metatype', () => {
  let metatype: MetatypeRegistry

  const tileSchema = objectClass({
    id: 'demo.tiles',
    name: 'Tile source',
    attributes: {
      url: { type: 'string', name: 'Tile URL' },
      zoom: { type: 'integer', default: 12, min: 1, max: 22 },
      retina: { type: 'boolean', required: false },
      layers: { type: 'string', cardinality: 'many', default: ['road'] },
      token: { type: 'password', required: false }
    }
  })

  beforeEach(() => {
    metatype = new MetatypeRegistry()
    metatype.designate('demo.tiles', tileSchema)
  })

  describe('designate', () => {
    it('should describe a PID', () => {
      expect(metatype.getObjectClassDefinition('demo.tiles')?.name).toBe('Tile source')
      expect(metatype.getPids()).toEqual(['demo.tiles'])
    })

    it('should keep factory PIDs apart, so a UI knows it may add instances', () => {
      metatype.designate('demo.tile-source', tileSchema, { factory: true })

      expect(metatype.getFactoryPids()).toEqual(['demo.tile-source'])
      expect(metatype.getPids()).toEqual(['demo.tiles'])
    })

    it('should answer a factory instance with its factory description', () => {
      metatype.designate('demo.tile-source', tileSchema, { factory: true })

      // What a form editing one instance needs; the instance has none of its own
      expect(metatype.getObjectClassDefinition('demo.tile-source~osm')?.name)
        .toBe('Tile source')
    })

    it('should not invent a description for an unknown PID', () => {
      expect(metatype.getObjectClassDefinition('demo.unknown')).toBeUndefined()
      expect(metatype.getObjectClassDefinition('demo.unknown~osm')).toBeUndefined()
    })

    it('should withdraw what a module registered', () => {
      metatype.designate('demo.other', tileSchema, { providedBy: 'tiles' })
      metatype.designate('demo.kept', tileSchema, { providedBy: 'clock' })

      metatype.removeAllOf('tiles')

      expect(metatype.getPids().sort()).toEqual(['demo.kept', 'demo.tiles'])
    })
  })

  describe('defaults', () => {
    it('should collect the declared default values', () => {
      expect(metatype.defaults('demo.tiles')).toEqual({ zoom: 12, layers: ['road'] })
    })

    it('should be empty for a PID without a description', () => {
      expect(metatype.defaults('demo.unknown')).toEqual({})
    })
  })

  describe('validate', () => {
    it('should accept values that fit', () => {
      expect(metatype.validate('demo.tiles', {
        url: 'https://tiles/{z}',
        zoom: 14,
        retina: true,
        layers: ['road', 'sat'],
        token: 'secret'
      })).toEqual([])
    })

    it('should treat an attribute as required unless it says otherwise', () => {
      // OSGi's default, and the surprising one
      expect(metatype.validate('demo.tiles', { layers: ['road'] }))
        .toEqual([{ attribute: 'url', message: 'is required' }])
    })

    it('should let a default stand in for a missing required value', () => {
      // zoom is required and absent, but declares a default
      const errors = metatype.validate('demo.tiles', { url: 'a' })
      expect(errors.map(error => error.attribute)).not.toContain('zoom')
    })

    it('should reject a wrong type', () => {
      expect(metatype.validate('demo.tiles', { url: 42, zoom: 'far' } as never))
        .toEqual([
          { attribute: 'url', message: 'expects text' },
          { attribute: 'zoom', message: 'expects a number' }
        ])
    })

    it('should reject a fractional integer', () => {
      expect(metatype.validate('demo.tiles', { url: 'a', zoom: 12.5 }))
        .toEqual([{ attribute: 'zoom', message: 'expects a whole number' }])
    })

    it('should enforce min and max', () => {
      expect(metatype.validate('demo.tiles', { url: 'a', zoom: 0 }))
        .toEqual([{ attribute: 'zoom', message: 'must be at least 1' }])
      expect(metatype.validate('demo.tiles', { url: 'a', zoom: 30 }))
        .toEqual([{ attribute: 'zoom', message: 'must be at most 22' }])
    })

    it('should enforce string length', () => {
      metatype.designate('demo.name', objectClass({
        id: 'demo.name',
        attributes: { title: { type: 'string', minLength: 3, maxLength: 6 } }
      }))

      expect(metatype.validate('demo.name', { title: 'ab' }))
        .toEqual([{ attribute: 'title', message: 'must be at least 3 character(s)' }])
      expect(metatype.validate('demo.name', { title: 'far too long' }))
        .toEqual([{ attribute: 'title', message: 'must be at most 6 character(s)' }])
    })

    it('should insist on a list where one is declared', () => {
      expect(metatype.validate('demo.tiles', { url: 'a', layers: 'road' } as never))
        .toEqual([{ attribute: 'layers', message: 'expects a list of values' }])
    })

    it('should refuse a list where a single value is declared', () => {
      expect(metatype.validate('demo.tiles', { url: ['a', 'b'] } as never))
        .toEqual([{ attribute: 'url', message: 'expects a single value' }])
    })

    it('should limit a list to the declared length', () => {
      metatype.designate('demo.limited', objectClass({
        id: 'demo.limited',
        attributes: { layers: { type: 'string', cardinality: 2 } }
      }))

      expect(metatype.validate('demo.limited', { layers: ['a', 'b', 'c'] }))
        .toEqual([{ attribute: 'layers', message: 'takes at most 2 value(s)' }])
    })

    it('should check every entry of a list', () => {
      metatype.designate('demo.zooms', objectClass({
        id: 'demo.zooms',
        attributes: { zooms: { type: 'integer', cardinality: 'many', min: 1 } }
      }))

      expect(metatype.validate('demo.zooms', { zooms: [4, 0] }))
        .toEqual([{ attribute: 'zooms', message: 'must be at least 1' }])
    })

    it('should restrict a value to the declared options', () => {
      metatype.designate('demo.mode', objectClass({
        id: 'demo.mode',
        attributes: {
          mode: {
            type: 'string',
            options: [{ value: 'car', label: 'By car' }, { value: 'bike' }]
          }
        }
      }))

      expect(metatype.validate('demo.mode', { mode: 'car' })).toEqual([])
      expect(metatype.validate('demo.mode', { mode: 'boat' }))
        .toEqual([{ attribute: 'mode', message: 'must be one of: car, bike' }])
    })

    it('should run a validator the declaration could not express', () => {
      metatype.designate('demo.endpoint', objectClass({
        id: 'demo.endpoint',
        attributes: {
          url: {
            type: 'string',
            validate: value => String(value).startsWith('https://')
              ? undefined
              : 'must be https'
          }
        }
      }))

      expect(metatype.validate('demo.endpoint', { url: 'http://insecure' }))
        .toEqual([{ attribute: 'url', message: 'must be https' }])
      expect(metatype.validate('demo.endpoint', { url: 'https://fine' })).toEqual([])
    })

    it('should report every problem at once, for a form to mark its fields', () => {
      const errors = metatype.validate('demo.tiles', { zoom: 99, layers: 'road' } as never)

      expect(errors.map(error => error.attribute)).toEqual(['url', 'zoom', 'layers'])
    })

    it('should leave attributes it does not know about alone', () => {
      // A configuration may carry more than a schema describes, and service.pid
      // always does
      expect(metatype.validate('demo.tiles', {
        url: 'a',
        'service.pid': 'demo.tiles',
        extra: 'kept'
      })).toEqual([])
    })

    it('should accept anything for a PID without a description', () => {
      expect(metatype.validate('demo.unknown', { whatever: 1 })).toEqual([])
    })
  })

  describe('coerce', () => {
    it('should fill in the defaults and then judge the result', () => {
      expect(metatype.coerce('demo.tiles', { url: 'https://tiles/{z}' })).toEqual({
        values: { url: 'https://tiles/{z}', zoom: 12, layers: ['road'] },
        errors: []
      })
    })

    it('should let given values win over defaults', () => {
      expect(metatype.coerce('demo.tiles', { url: 'a', zoom: 3 }).values.zoom).toBe(3)
    })

    it('should report what is still wrong after the defaults', () => {
      expect(metatype.coerce('demo.tiles', {}).errors)
        .toEqual([{ attribute: 'url', message: 'is required' }])
    })
  })

  describe('localization', () => {
    const localized = objectClass({
      id: 'demo.localized',
      name: '%title',
      attributes: {
        url: { type: 'string', name: '%url.name', description: '%url.help' },
        mode: {
          type: 'string',
          name: 'Mode',
          options: [{ value: 'car', label: '%mode.car' }]
        }
      },
      localization: {
        de: {
          title: 'Kartenquelle',
          'url.name': 'Kachel-URL',
          'url.help': 'Adresse mit {z}/{x}/{y}',
          'mode.car': 'Mit dem Auto'
        }
      }
    })

    beforeEach(() => {
      metatype.designate('demo.localized', localized)
    })

    it('should resolve %key references for a locale', () => {
      const definition = metatype.getObjectClassDefinition('demo.localized', 'de')

      expect(definition?.name).toBe('Kartenquelle')
      expect(definition?.attributes.url.name).toBe('Kachel-URL')
      expect(definition?.attributes.url.description).toBe('Adresse mit {z}/{x}/{y}')
      expect(definition?.attributes.mode.options?.[0].label).toBe('Mit dem Auto')
    })

    it('should leave a plain label untouched', () => {
      expect(metatype.getObjectClassDefinition('demo.localized', 'de')?.attributes.mode.name)
        .toBe('Mode')
    })

    it('should keep the key visible when a translation is missing', () => {
      metatype.designate('demo.gap', objectClass({
        id: 'demo.gap',
        name: '%missing',
        attributes: {},
        localization: { de: {} }
      }))

      // A visible placeholder is easier to fix than an empty label
      expect(metatype.getObjectClassDefinition('demo.gap', 'de')?.name).toBe('%missing')
    })

    it('should return the raw description without a locale', () => {
      expect(metatype.getObjectClassDefinition('demo.localized')?.name).toBe('%title')
    })

    it('should fall back to the raw description for an unknown locale', () => {
      expect(metatype.getObjectClassDefinition('demo.localized', 'fr')?.name).toBe('%title')
    })

    it('should list the locales a description has', () => {
      expect(metatype.getLocales('demo.localized')).toEqual(['de'])
      expect(metatype.getLocales('demo.tiles')).toEqual([])
    })
  })
})
