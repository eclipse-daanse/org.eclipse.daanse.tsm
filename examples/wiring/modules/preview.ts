import { activate, component, inject } from '@eclipse-daanse/tsm/decorators'
import { LOG_SERVICE, type Log } from '../src/contracts.js'

/** Runs once the editor service is really there, not just promised */
@component()
export class Preview {
  constructor(@inject(LOG_SERVICE) private log: Log) {}

  @activate()
  start(): void {
    this.log.write('preview', 'the editor service exists, not just on paper')
  }
}
