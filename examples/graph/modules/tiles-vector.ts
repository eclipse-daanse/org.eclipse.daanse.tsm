import { component } from '@eclipse-daanse/tsm/decorators'
import { TILE_SERVICE, type TileSource } from '../src/contracts.js'

/**
 * A second provider for the same service, ranked higher. Both registrations
 * exist; consumers see this one, and the raster tiles stand by.
 */
@component({ service: [TILE_SERVICE], properties: { kind: 'vector' }, ranking: 10 })
export class VectorTiles implements TileSource {
  readonly name = 'vector tiles'
}
