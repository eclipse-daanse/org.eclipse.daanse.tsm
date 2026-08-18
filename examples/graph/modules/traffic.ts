import { component } from '@eclipse-daanse/tsm/decorators'
import { TRAFFIC_SERVICE, type TrafficFeed } from '../src/contracts.js'

/** Loaded on demand: the optional dependency of the navigation bundle */
@component({ service: [TRAFFIC_SERVICE] })
export class LiveTraffic implements TrafficFeed {
  readonly name = 'live traffic'
}
