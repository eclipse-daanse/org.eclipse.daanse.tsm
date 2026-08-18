/** Service contracts of the graph example */

export const TILE_SERVICE = 'demo.tiles'
export const ROUTE_SERVICE = 'demo.routing'
export const TRAFFIC_SERVICE = 'demo.traffic'
export const MAP_VIEW = 'demo.map'

export interface TileSource {
  readonly name: string
}

export interface RouteEngine {
  readonly name: string
}

export interface TrafficFeed {
  readonly name: string
}

export interface MapView {
  describe(): string
}
