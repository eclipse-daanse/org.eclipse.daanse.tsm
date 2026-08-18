import { activate, component, deactivate, inject } from '@eclipse-daanse/tsm/decorators'
import { LOG_SERVICE, MAP_VIEW, type Log } from '../src/contracts.js'

/**
 * A consumer, to show how far a single PID reaches.
 *
 * Its manifest requires `demo.tiles`, and nothing provides that until the tiles
 * component has its configuration. So this bundle is parked — not because of
 * anything it declared about configuration, but because a component elsewhere is
 * waiting for a value.
 */
@component({ service: [MAP_VIEW] })
export class Map2D {
  constructor(@inject(LOG_SERVICE) private log: Log) {}

  @activate()
  start(): void {
    this.log.write('Map2D', 'map is up — its tile service exists')
  }

  @deactivate()
  stop(): void {
    this.log.write('Map2D', 'map is down')
  }
}
