/**
 * Plugin Bundle - Entry Point
 *
 * Nutzt Vue SFC mit bare imports.
 * Der TSM Plugin transformiert alle vue/primevue imports zu __tsm__.require()
 */

import type { ModuleContext, ModuleLifecycle } from 'tsm'

// Vue SFC Component - bare imports werden automatisch transformiert
export { default as MyPluginPanel } from './components/PluginPanel.vue'

/**
 * Plugin Lifecycle
 */
export const activate = (context: ModuleContext): void => {
  context.log.info('MyPlugin activated!')

  // Service registrieren
  context.services.register('my-plugin.api', {
    getData: () => ({ message: 'Hello from Plugin!' })
  })
}

export const deactivate = (context: ModuleContext): void => {
  context.log.info('MyPlugin deactivated!')
  context.services.unregister('my-plugin.api')
}

// Default export für Lifecycle
export default { activate, deactivate } satisfies ModuleLifecycle
