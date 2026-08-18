import { activate, component, deactivate, inject, modified } from '@eclipse-daanse/tsm/decorators'
import type { ComponentContext } from '@eclipse-daanse/tsm'
import {
  CLOCK_PID,
  LOG_SERVICE,
  RESTARTING_CLOCK,
  STEADY_CLOCK,
  type Clock,
  type ClockConfig,
  type Log
} from '../src/contracts.js'

/**
 * Two components on the same PID, differing in one thing: whether they have a
 * `@modified()` method.
 *
 * One configuration change therefore shows both answers side by side. Watch the
 * tick count: the steady clock keeps counting, the restarting one begins at zero
 * because it is a new object.
 */
@component({ service: [STEADY_CLOCK], configurationPid: CLOCK_PID })
export class SteadyClock implements Clock {
  private ticks = 0
  private timer?: ReturnType<typeof setInterval>

  constructor(@inject(LOG_SERVICE) private log: Log) {}

  @activate()
  start(context: ComponentContext<ClockConfig>): void {
    this.log.write('SteadyClock', `started at ${context.configuration.interval ?? 1000}ms`)
    this.restartTimer(context.configuration.interval ?? 1000)
  }

  @modified()
  update(context: ComponentContext<ClockConfig>): void {
    // The instance survives, so the count survives with it
    this.log.write(
      'SteadyClock',
      `now ${context.configuration.interval}ms, still at ${this.ticks} ticks`
    )
    this.restartTimer(context.configuration.interval)
  }

  @deactivate()
  stop(): void {
    // The interval is the reason this component has a lifecycle at all: whoever
    // starts one has to stop it, or it keeps running after the bundle is gone
    clearInterval(this.timer)
    this.log.write('SteadyClock', 'stopped')
  }

  count(): number {
    return this.ticks
  }

  private restartTimer(interval: number): void {
    clearInterval(this.timer)
    this.timer = setInterval(() => { this.ticks++ }, Math.max(interval, 100))
  }
}

/** The same clock without `@modified()`: a change rebuilds it */
@component({ service: [RESTARTING_CLOCK], configurationPid: CLOCK_PID })
export class RestartingClock implements Clock {
  private ticks = 0
  private timer?: ReturnType<typeof setInterval>

  constructor(@inject(LOG_SERVICE) private log: Log) {}

  @activate()
  start(context: ComponentContext<ClockConfig>): void {
    this.log.write('RestartingClock', `started at ${context.configuration.interval ?? 1000}ms`)
    this.timer = setInterval(() => { this.ticks++ }, Math.max(context.configuration.interval ?? 1000, 100))
  }

  @deactivate()
  stop(): void {
    clearInterval(this.timer)
    this.log.write('RestartingClock', `stopped after ${this.ticks} ticks`)
  }

  count(): number {
    return this.ticks
  }
}
