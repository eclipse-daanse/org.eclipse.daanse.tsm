import { activate, component, deactivate, inject } from '@eclipse-daanse/tsm/decorators'
import type { ComponentContext } from '@eclipse-daanse/tsm'
import {
  LOG_SERVICE,
  TILES_PID,
  TILE_SERVICE,
  TileSchema,
  type Log,
  type TileConfig
} from '../src/contracts.js'

/**
 * A component that cannot run without configuration.
 *
 * `require` is the interesting policy: until the PID exists this class is not
 * registered at all, so `demo.tiles` has no provider and anything waiting for
 * that service waits too. The bundle around it stays active the whole time.
 */
@component({
  service: [TILE_SERVICE],
  configurationPid: TILES_PID,
  configurationPolicy: 'require',
  configurationSchema: TileSchema,
  properties: { kind: 'raster' }
})
export class RasterTiles {
  private url = ''

  constructor(@inject(LOG_SERVICE) private log: Log) {}

  @activate()
  start(context: ComponentContext<TileConfig>): void {
    // `zoom` is declared with a default, so it is always there — no `?? 19` here
    this.url = context.configuration.url
    this.log.write(
      'RasterTiles',
      `started with ${this.url} up to zoom ${context.configuration.zoom}`
    )
  }

  @deactivate()
  stop(): void {
    this.log.write('RasterTiles', 'stopped')
  }

  describe(): string {
    return this.url
  }
}
