import { component } from '@eclipse-daanse/tsm/decorators'
import { TILE_SERVICE, type TileSource } from '../src/contracts.js'

/** One bundle, one component, one service — the simplest shape */
@component({ service: [TILE_SERVICE], properties: { kind: 'raster' } })
export class RasterTiles implements TileSource {
  readonly name = 'raster tiles'
}
