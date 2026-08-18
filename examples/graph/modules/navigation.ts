import { activate, component, deactivate, inject } from '@eclipse-daanse/tsm/decorators'
import {
  ROUTE_SERVICE,
  TRAFFIC_SERVICE,
  type RouteEngine,
  type TrafficFeed
} from '../src/contracts.js'

/**
 * One bundle, two components. The engine offers a service; the watcher only has
 * a lifecycle and consumes — which is why registration happens for both before
 * either is activated.
 */
@component({ service: [ROUTE_SERVICE] })
export class ShortestPath implements RouteEngine {
  readonly name = 'shortest path'
}

@component()
export class TrafficWatcher {
  constructor(
    @inject(ROUTE_SERVICE) private readonly routing: RouteEngine,
    @inject(TRAFFIC_SERVICE, { optional: true }) private readonly traffic?: TrafficFeed
  ) {}

  @activate()
  start(): void {
    console.debug(`[navigation] watching ${this.routing.name}, traffic: ${this.traffic?.name ?? 'none'}`)
  }

  @deactivate()
  stop(): void {
    console.debug('[navigation] stopped watching')
  }
}
