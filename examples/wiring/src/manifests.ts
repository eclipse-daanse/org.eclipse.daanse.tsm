/**
 * The manifests — and in this example they are the subject, not the setup.
 *
 * Resolution reads these and nothing else. It answers whether a module *could*
 * run, before a single line of it is fetched.
 */

import type { ModuleManifest } from '@eclipse-daanse/tsm'
import { EDITOR_SERVICE, PDF_SERVICE, THEME_NAMESPACE } from './contracts.js'

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
 * A dark theme, offered as a capability rather than a service.
 *
 * Nothing is registered at runtime for this: it is a statement in the manifest
 * that whoever wires to it gets a theme with these attributes.
 */
export const themeDark = bundle('theme-dark', {
  capabilities: [{
    namespace: THEME_NAMESPACE,
    attributes: { name: 'dark', version: '2.1.0', contrast: 7 }
  }]
})

/** An older, lower-contrast theme — the one the editor will refuse */
export const themeLight = bundle('theme-light', {
  capabilities: [{
    namespace: THEME_NAMESPACE,
    attributes: { name: 'light', version: '1.9.0', contrast: 4 }
  }]
})

/**
 * Wants a theme, but not any theme: enough contrast, and version 2.
 *
 * `versionRange` rather than `(version>=2.0.0)` in the filter, because a filter
 * compares text — and as text, `1.9.0` sorts above `2.1.0`.
 */
export const editor = bundle('editor', {
  requirements: [{
    namespace: THEME_NAMESPACE,
    filter: '(contrast>=7)',
    versionRange: '^2.0.0'
  }],
  provides: [{ id: EDITOR_SERVICE }]
})

/** Wires to *every* theme there is, not just the best one */
export const gallery = bundle('gallery', {
  requirements: [{
    namespace: THEME_NAMESPACE,
    cardinality: 'multiple'
  }]
})

/**
 * Waits for a service somebody promises: `editor` declares it in `provides`, so
 * this resolves — and then waits at runtime until the editor actually registers it.
 */
export const preview = bundle('preview', {
  requiresService: [{ id: EDITOR_SERVICE }]
})

/**
 * Waits for a service **nobody** promises.
 *
 * This is the distinction the whole example is about: `preview` is waiting,
 * `exporter` is waiting in vain, and only the resolution can tell them apart.
 */
export const exporter = bundle('exporter', {
  requiresService: [{ id: PDF_SERVICE }]
})

/** A plain module dependency, to show it is the same mechanism underneath */
export const workspace = bundle('workspace', {
  dependencies: [{ id: 'editor', versionRange: '^1.0.0' }]
})

/** What the page starts with */
export const startup: ModuleManifest[] = [
  themeDark, themeLight, editor, gallery, preview, exporter, workspace
]

/** Added or swapped in by the buttons */
export const variants = {
  /** The same theme, but too old for the editor's range */
  themeDarkDowngraded: bundle('theme-dark', {
    capabilities: [{
      namespace: THEME_NAMESPACE,
      attributes: { name: 'dark', version: '1.5.0', contrast: 7 }
    }]
  }),

  /** Makes `exporter` resolvable — the promise it was waiting for */
  pdfProvider: bundle('pdf', {
    provides: [{ id: PDF_SERVICE }]
  })
}
