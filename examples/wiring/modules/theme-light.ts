import { activate, component, inject } from '@eclipse-daanse/tsm/decorators'
import { LOG_SERVICE, type Log } from '../src/contracts.js'

/**
 * The lower-contrast theme. It resolves and runs either way — whether anybody
 * wires to it is not its concern.
 */
@component()
export class ThemeLight {
  constructor(@inject(LOG_SERVICE) private log: Log) {}

  @activate()
  start(): void {
    this.log.write('theme-light', 'running; nobody has to wire to it')
  }
}
