import type { ModuleManifest } from '@eclipse-daanse/tsm'
import { TILE_SERVICE } from './contracts.js'

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

export const bundles: ModuleManifest[] = [
  bundle('tiles'),
  bundle('clock'),
  bundle('sources'),
  // The only bundle that declares a requirement: it needs a tile service, and
  // whether one exists depends on configuration elsewhere
  bundle('map', { requiresService: [{ id: TILE_SERVICE }] })
]
