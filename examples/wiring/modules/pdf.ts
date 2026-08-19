import { activate, component, inject } from '@eclipse-daanse/tsm/decorators'
import { LOG_SERVICE, PDF_SERVICE, type Log } from '../src/contracts.js'

/** The promise `exporter` was waiting for */
@component({ service: [PDF_SERVICE] })
export class PdfWriter {
  constructor(@inject(LOG_SERVICE) private log: Log) {}

  @activate()
  start(): void {
    this.log.write('pdf', `registered ${PDF_SERVICE}`)
  }
}
