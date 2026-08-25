import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { ModuleLoader, serviceId } from '../index.js'
import { component } from '../decorators.js'

/**
 * The README's "shortest thing that works", executed rather than eyeballed.
 *
 * The previous quick start did not compile — `new ServiceRegistry()` on a type,
 * and an option named `services` that the loader never had. Documentation nobody
 * runs is documentation nobody can trust, so this one runs.
 */
describe('the README quick start', () => {
  it('runs', async () => {
    interface Greeter { greet(name: string): string }
    const Greeter = serviceId<Greeter>('demo.greeter')

    @component({ service: [Greeter] })
    class Polite implements Greeter {
      greet(name: string): string { return `Good day, ${name}.` }
    }

    const loader = new ModuleLoader({ entryResolver: () => ({ Polite }) })

    loader.register([{
      id: 'polite',
      version: '1.0.0',
      entry: '/modules/polite.js',
      provides: [{ id: 'demo.greeter' }]
    }])

    await loader.loadAll()

    expect(loader.getServiceRegistry().getRequired(Greeter).greet('world'))
      .toBe('Good day, world.')
  })
})
