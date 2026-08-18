import { describe, it, expectTypeOf } from 'vitest'
import { objectClass, type ConfigurationOf } from '../Metatype.js'

/**
 * The schema is the type as well, so these are the assertions that keep the two
 * from drifting — in Java they are separate artefacts and can.
 *
 * Run with `npm run typecheck:types`; nothing here executes. The import carries a
 * `.js` extension because this file is checked by tsc under node16 resolution,
 * unlike the runtime tests, which only ever pass through esbuild.
 */
describe('ConfigurationOf', () => {
  const schema = objectClass({
    id: 'demo.tiles',
    attributes: {
      url: { type: 'string' },
      zoom: { type: 'integer', default: 12 },
      scale: { type: 'number' },
      retina: { type: 'boolean' },
      token: { type: 'password' },
      layers: { type: 'string', cardinality: 'many' },
      zooms: { type: 'integer', cardinality: 3 },
      optional: { type: 'string', required: false },
      defaulted: { type: 'string', required: false, default: 'x' }
    }
  })

  type Config = ConfigurationOf<typeof schema>

  it('should map declared types to value types', () => {
    expectTypeOf<Config['url']>().toEqualTypeOf<string>()
    expectTypeOf<Config['zoom']>().toEqualTypeOf<number>()
    expectTypeOf<Config['scale']>().toEqualTypeOf<number>()
    expectTypeOf<Config['retina']>().toEqualTypeOf<boolean>()
    // A password is text with a hint for the user interface, not another type
    expectTypeOf<Config['token']>().toEqualTypeOf<string>()
  })

  it('should turn cardinality into an array', () => {
    expectTypeOf<Config['layers']>().toEqualTypeOf<string[]>()
    // A numeric cardinality is a maximum length, still a list
    expectTypeOf<Config['zooms']>().toEqualTypeOf<number[]>()
  })

  it('should make only what may be absent optional', () => {
    expectTypeOf<Config>().toHaveProperty('optional')
    expectTypeOf<Config['optional']>().toEqualTypeOf<string | undefined>()

    // Required by default, so present even without a value in hand
    expectTypeOf<Config['url']>().toEqualTypeOf<string>()
    // A default stands in for it, so reading it never yields undefined
    expectTypeOf<Config['zoom']>().toEqualTypeOf<number>()
    expectTypeOf<Config['defaulted']>().toEqualTypeOf<string>()
  })

  it('should carry every declared attribute', () => {
    // One by one rather than comparing the key unions: their order is not
    // something TypeScript promises
    expectTypeOf<Config>().toHaveProperty('url')
    expectTypeOf<Config>().toHaveProperty('zoom')
    expectTypeOf<Config>().toHaveProperty('scale')
    expectTypeOf<Config>().toHaveProperty('retina')
    expectTypeOf<Config>().toHaveProperty('token')
    expectTypeOf<Config>().toHaveProperty('layers')
    expectTypeOf<Config>().toHaveProperty('zooms')
    expectTypeOf<Config>().toHaveProperty('optional')
    expectTypeOf<Config>().toHaveProperty('defaulted')
  })

  it('should not invent an attribute the schema never declared', () => {
    // @ts-expect-error - 'unknownAttribute' is not part of the schema
    expectTypeOf<Config['unknownAttribute']>().toBeString()
  })

  it('should be assignable from a matching object', () => {
    const values = {
      url: 'https://tiles/{z}',
      zoom: 12,
      scale: 1.5,
      retina: true,
      token: 'secret',
      layers: ['road'],
      zooms: [1, 2],
      defaulted: 'x'
    }

    expectTypeOf(values).toExtend<Config>()
  })
})
