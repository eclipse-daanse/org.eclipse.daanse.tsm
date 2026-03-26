/**
 * TSM Vite Plugins
 *
 * Build tools for TSM modules.
 *
 * Usage:
 *   import { tsmPlugin, createTsmExternals, generateCssLoader } from 'tsm/vite'
 */

export {
  tsmPlugin,
  generateCssLoader,
  createTsmExternals,
  type TsmPluginOptions,
  type CreateExternalsOptions
} from './plugin.js'
