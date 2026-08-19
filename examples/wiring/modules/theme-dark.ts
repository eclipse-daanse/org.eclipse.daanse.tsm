import { activate, component, inject } from '@eclipse-daanse/tsm/decorators'
import { LOG_SERVICE, type Log } from '../src/contracts.js'

/**
 * Offers the theme capability — a statement in its manifest, not something this
 * class registers. Nothing here has to do with the wiring: that was settled
 * before this file was fetched.
 */
@component()
export class ThemeDark {
  constructor(@inject(LOG_SERVICE) private log: Log) {}

  @activate()
  start(): void {
    this.log.write('theme-dark', 'running; its theme capability was wired at resolve time')
  }
}
