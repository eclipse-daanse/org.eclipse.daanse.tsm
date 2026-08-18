/** Service IDs and configuration PIDs the bundles agree on */

export const TILE_SERVICE = 'demo.tiles'
export const STEADY_CLOCK = 'demo.clock.steady'
export const RESTARTING_CLOCK = 'demo.clock.restarting'
export const MAP_VIEW = 'demo.map'
export const LOG_SERVICE = 'demo.log'

/** A PID is just a name; by convention it looks like the thing it configures */
export const TILES_PID = 'demo.tiles'
export const CLOCK_PID = 'demo.clock'
export const TILE_SOURCE_FACTORY_PID = 'demo.tile-source'

export interface TileConfig {
  url: string
  retina?: boolean
}

export interface ClockConfig {
  interval: number
}

export interface TileSourceConfig {
  name: string
  url: string
}

/** Both clocks offer this, so the host can read their tick counts */
export interface Clock {
  count(): number
}

/** What the components report their lifecycle to, injected as a service */
export interface Log {
  write(source: string, message: string): void
}
