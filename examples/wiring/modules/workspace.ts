import { activate, component, inject } from '@eclipse-daanse/tsm/decorators'
import { LOG_SERVICE, type Log } from '../src/contracts.js'

/**
 * Depends on `editor` the ordinary way, which is an osgi.identity requirement
 * underneath.
 */
@component()
export class Workspace {
  constructor(@inject(LOG_SERVICE) private log: Log) {}

  @activate()
  start(): void {
    this.log.write('workspace', 'running after the module it depends on')
  }
}
