/** Service IDs, configuration PIDs, and what those configurations look like */

import { objectClass, type ConfigurationOf } from '@eclipse-daanse/tsm'

export const TILE_SERVICE = 'demo.tiles'
export const MAP_VIEW = 'demo.map'
export const LOG_SERVICE = 'demo.log'
export const STEADY_CLOCK = 'demo.clock.steady'
export const RESTARTING_CLOCK = 'demo.clock.restarting'

/** A PID is just a name; by convention it looks like the thing it configures */
export const TILES_PID = 'demo.tiles'
export const CLOCK_PID = 'demo.clock'
export const TILE_SOURCE_FACTORY_PID = 'demo.tile-source'

/**
 * The schemas, which are the types as well.
 *
 * In Java a configuration needs an annotated interface for the type and
 * annotations for the description; here `ConfigurationOf` derives the one from
 * the other, so they cannot disagree. The page builds its forms from exactly
 * these declarations.
 */
export const TileSchema = objectClass({
  id: 'demo.tiles',
  name: 'Raster tiles',
  description: 'The tile server this map draws from',
  attributes: {
    url: {
      type: 'string',
      name: 'Tile URL',
      description: 'Template with {z}/{x}/{y} placeholders',
      minLength: 8
    },
    zoom: {
      type: 'integer',
      name: 'Maximum zoom',
      default: 19,
      min: 1,
      max: 22
    },
    retina: { type: 'boolean', name: 'Retina tiles', default: false },
    token: { type: 'password', name: 'Access token', required: false }
  }
})

export type TileConfig = ConfigurationOf<typeof TileSchema>

export const ClockSchema = objectClass({
  id: 'demo.clock',
  name: 'Clock',
  description: 'How often the clocks tick',
  attributes: {
    interval: {
      type: 'integer',
      name: 'Interval',
      description: 'Milliseconds between ticks',
      default: 1000,
      min: 100,
      max: 10000
    }
  }
})

export type ClockConfig = ConfigurationOf<typeof ClockSchema>

export const TileSourceSchema = objectClass({
  id: 'demo.tile-source',
  name: 'Tile source',
  description: 'One entry per source; add as many as you like',
  attributes: {
    name: { type: 'string', name: 'Name', minLength: 2 },
    url: { type: 'string', name: 'Tile URL', minLength: 8 },
    kind: {
      type: 'string',
      name: 'Kind',
      default: 'raster',
      options: [
        { value: 'raster', label: 'Raster' },
        { value: 'vector', label: 'Vector' }
      ]
    },
    'service.ranking': {
      type: 'integer',
      name: 'Ranking',
      description: 'Higher wins when several sources answer',
      default: 0,
      required: false
    }
  }
})

export type TileSourceConfig = ConfigurationOf<typeof TileSourceSchema>

/** Both clocks offer this, so the host can read their tick counts */
export interface Clock {
  count(): number
}

/** What the components report their lifecycle to, injected as a service */
export interface Log {
  write(source: string, message: string): void
}
