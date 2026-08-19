import { activate, component, inject } from '@eclipse-daanse/tsm/decorators'
import { LOG_SERVICE, type Log } from '../src/contracts.js'

/**
 * Will not get here as long as nothing promises the PDF service — and with a
 * resolution that is known before the module is even fetched.
 */
@component()
export class Exporter {
  constructor(@inject(LOG_SERVICE) private log: Log) {}

  @activate()
  start(): void {
    this.log.write('exporter', 'running — somebody must have promised the PDF service')
  }
}
