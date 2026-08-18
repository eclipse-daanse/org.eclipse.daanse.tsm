import { component, inject } from '@eclipse-daanse/tsm/decorators'

/**
 * Requires a service nobody provides, so this bundle stays parked — the graph
 * shows it with a dashed outline and names what it waits for.
 */
@component({ service: ['demo.elevation'] })
export class ElevationLayer {
  constructor(@inject('demo.terrain') private readonly terrain: { name: string }) {}

  describe(): string {
    return `elevation over ${this.terrain.name}`
  }
}
