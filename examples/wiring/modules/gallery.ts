import { activate, component, inject } from '@eclipse-daanse/tsm/decorators'
import { LOG_SERVICE, type Log } from '../src/contracts.js'

/**
 * Wired to every theme there is, through cardinality `multiple`.
 */
@component()
export class Gallery {
  constructor(@inject(LOG_SERVICE) private log: Log) {}

  @activate()
  start(): void {
    this.log.write('gallery', 'running, wired to every theme')
  }
}
