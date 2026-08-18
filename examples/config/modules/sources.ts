import { activate, component, deactivate, inject } from '@eclipse-daanse/tsm/decorators'
import type { ComponentContext } from '@eclipse-daanse/tsm'
import {
  LOG_SERVICE,
  TILE_SERVICE,
  TILE_SOURCE_FACTORY_PID,
  type Log,
  type TileSourceConfig
} from '../src/contracts.js'

/**
 * One class, one instance per configuration.
 *
 * The PID names a *factory* PID, and that alone is what makes this a template
 * rather than a singleton — the same rule DS follows. Each instance registers
 * `demo.tiles` for itself with its own properties, so a consumer can pick one
 * with a target filter like `(name=satellite)`.
 */
@component({
  service: [TILE_SERVICE],
  configurationPid: TILE_SOURCE_FACTORY_PID,
  configurationPolicy: 'require',
  properties: { kind: 'raster' }
})
export class TileSource {
  private name = 'unnamed'

  constructor(@inject(LOG_SERVICE) private log: Log) {}

  @activate()
  start(context: ComponentContext<TileSourceConfig>): void {
    this.name = context.configuration.name
    this.log.write('TileSource', `instance '${this.name}' from ${context.configurationPid}`)
  }

  @deactivate()
  stop(): void {
    this.log.write('TileSource', `instance '${this.name}' gone`)
  }
}
