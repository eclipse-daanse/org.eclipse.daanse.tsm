import type { ModuleManifest } from '../../../src/index.js'
import { UI_COMPONENT, WORKBENCH_ROOT } from './contracts.js'

function view(
  id: string,
  region: string,
  order: number,
  options: { ranking?: number; slot?: string } = {}
): ModuleManifest {
  return {
    id,
    name: id,
    version: '1.0.0',
    entry: `/modules/${id}.ts`,
    exports: {},
    provides: [{
      id: UI_COMPONENT,
      ranking: options.ranking,
      properties: options.slot === undefined
        ? { region, order }
        : { region, order, slot: options.slot }
    }]
  }
}

export const shell: ModuleManifest = {
  id: 'shell',
  name: 'Workbench shell',
  version: '1.0.0',
  entry: '/modules/shell.ts',
  exports: {},
  requiresService: [
    // The shell survives every change to the set and is told about it
    { id: UI_COMPONENT, cardinality: '0..n', policy: 'dynamic' },
    { id: WORKBENCH_ROOT }
  ]
}

/** Loaded at startup */
export const startupViews: ModuleManifest[] = [
  view('search-box', 'toolbar', 1),
  // Both offer the 'outline' slot, so only the higher ranked one is shown
  view('outline', 'sidebar', 1, { slot: 'outline' }),
  view('outline-pro', 'sidebar', 1, { slot: 'outline', ranking: 10 }),
  view('notes', 'main', 2)
]

/** Loaded and unloaded on demand, to watch a view come and go */
export const clock: ModuleManifest = view('clock', 'main', 1)
