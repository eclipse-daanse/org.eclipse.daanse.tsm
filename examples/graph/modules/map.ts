import { component, inject } from '@eclipse-daanse/tsm/decorators'
import {
  MAP_VIEW,
  ROUTE_SERVICE,
  TILE_SERVICE,
  type MapView,
  type RouteEngine,
  type TileSource
} from '../src/contracts.js'

/** A consumer that is itself a service: it needs tiles and routing */
@component({ service: [MAP_VIEW] })
export class Map2D implements MapView {
  constructor(
    @inject(TILE_SERVICE) private readonly tiles: TileSource,
    @inject(ROUTE_SERVICE) private readonly routing: RouteEngine
  ) {}

  describe(): string {
    return `${this.tiles.name} + ${this.routing.name}`
  }
}
