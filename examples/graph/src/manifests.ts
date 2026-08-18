import type { ModuleManifest } from '@eclipse-daanse/tsm'
import { MAP_VIEW, ROUTE_SERVICE, TILE_SERVICE, TRAFFIC_SERVICE } from './contracts.js'

function bundle(id: string, extra: Partial<ModuleManifest> = {}): ModuleManifest {
  return {
    id,
    name: id,
    version: '1.0.0',
    entry: `/modules/${id}.ts`,
    exports: {},
    ...extra
  }
}

/**
 * No `provides` anywhere: the `@component()` declarations carry that, and
 * `requiresService` is only stated where a bundle really waits for something.
 */
export const startup: ModuleManifest[] = [
  bundle('tiles'),
  bundle('navigation'),
  bundle('map', {
    requiresService: [{ id: TILE_SERVICE }, { id: ROUTE_SERVICE }]
  }),
  bundle('elevation', {
    requiresService: [{ id: 'demo.terrain' }]
  })
]

/** Loaded from the buttons, to watch the graph change */
export const onDemand: Record<string, ModuleManifest> = {
  'tiles-vector': bundle('tiles-vector'),
  traffic: bundle('traffic', {
    provides: [{ id: TRAFFIC_SERVICE }]
  })
}

export const serviceOrder = [TILE_SERVICE, ROUTE_SERVICE, TRAFFIC_SERVICE, MAP_VIEW]
