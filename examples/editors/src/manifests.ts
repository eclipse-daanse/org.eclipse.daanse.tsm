import type { ModuleManifest } from '@eclipse-daanse/tsm'

function bundle(id: string, extra: Partial<ModuleManifest> = {}): ModuleManifest {
  return { id, name: id, version: '1.0.0', entry: `/modules/${id}.ts`, exports: {}, ...extra }
}

export const bundles: ModuleManifest[] = [
  // Registers the condition the others wait for
  bundle('workspace'),
  // Offers the undo stack, per consuming module
  bundle('history'),
  // Two bundles offering tools, so the toolbar collects across bundles
  bundle('text-tools'),
  bundle('draw-tools'),
  // The factory component, and the toolbar that collects
  bundle('editors')
]
