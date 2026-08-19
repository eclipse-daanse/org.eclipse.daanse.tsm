import { activate, component, inject } from '@eclipse-daanse/tsm/decorators'
import { EDITOR_SERVICE, LOG_SERVICE, type Log } from '../src/contracts.js'

/**
 * Registers the service its manifest promised.
 *
 * The promise was checked at resolve time; that it is kept is a separate matter,
 * and this is where it happens.
 */
@component({ service: [EDITOR_SERVICE] })
export class Editor {
  constructor(@inject(LOG_SERVICE) private log: Log) {}

  @activate()
  start(): void {
    this.log.write('editor', `registered ${EDITOR_SERVICE}`)
  }
}
