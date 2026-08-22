import { describe, it, expectTypeOf } from 'vitest'
import { serviceId, type ServiceId, type ServiceOf } from '../serviceId.js'
import { DefaultServiceRegistry } from '../ServiceRegistry.js'

/**
 * What a typed service id buys, asserted at the type level — because that is the
 * only level it exists on. At runtime it is a string, and the tests in
 * `serviceId.test.ts` check that half.
 *
 * Run with `npm run typecheck:types`; nothing here executes.
 */

// The contract module: one name in both namespaces, the string exactly once
interface TileService { tileUrl(z: number): string }
const TileService = serviceId<TileService>('demo.tiles')

interface Greeting { text(): string }
const Greeting = serviceId<Greeting>('demo.greeting')

const registry = new DefaultServiceRegistry()

describe('ServiceId', () => {
  it('is a string, so everything that took an id still takes it', () => {
    expectTypeOf(TileService).toExtend<string>()
    expectTypeOf<ServiceId<TileService>>().toExtend<string>()
  })

  it('accepts a plain string literal, so nothing has to be migrated', () => {
    const id: ServiceId<TileService> = 'demo.tiles'
    expectTypeOf(id).toExtend<string>()
  })

  it('names what it stands for', () => {
    expectTypeOf<ServiceOf<typeof TileService>>().toEqualTypeOf<TileService>()
  })
})

describe('resolving', () => {
  it('needs no type argument', () => {
    expectTypeOf(registry.get(TileService)).toEqualTypeOf<TileService | undefined>()
  })

  it('is not optional for getRequired', () => {
    expectTypeOf(registry.getRequired(TileService)).toEqualTypeOf<TileService>()
  })

  it('carries through a target filter', () => {
    expectTypeOf(registry.getMatching(TileService, '(kind=raster)'))
      .toEqualTypeOf<TileService | undefined>()
  })

  it('carries through a collection', () => {
    expectTypeOf(registry.getServices(TileService)).toEqualTypeOf<TileService[]>()
  })

  it('keeps the explicit form working for a plain string', () => {
    expectTypeOf(registry.get<TileService>('demo.tiles'))
      .toEqualTypeOf<TileService | undefined>()
  })
})

describe('the mismatch it catches', () => {
  it('refuses the wrong contract for an id', () => {
    // The whole reason for the type: this used to compile
    // @ts-expect-error — Greeting is not a TileService
    const wrong: TileService | undefined = registry.get(Greeting)
    void wrong
  })

  it('refuses registering something that is not the contract', () => {
    // @ts-expect-error — a Greeting cannot be registered as demo.tiles
    registry.register(TileService, { text: () => 'hi' })
  })

  it('refuses a factory of the wrong contract', () => {
    // @ts-expect-error — the factory has to produce a TileService
    registry.bind(TileService, () => ({ text: () => 'hi' }))
  })

  it('accepts the right one', () => {
    registry.register(TileService, { tileUrl: (z: number) => `/${z}` })
    registry.bind(Greeting, () => ({ text: () => 'hi' }))
  })
})
