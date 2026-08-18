/**
 * TSM DevTools - output sink
 *
 * The commands write through this rather than calling `console` directly, so the
 * same command can be checked in a test without a browser.
 */

/** Where devtools output goes */
export interface DevtoolsOutput {
  /** A line, optionally with CSS segments for `%c` placeholders */
  log(message: string, ...styles: string[]): void
  /** Tabular data, when the host can render it */
  table(data: unknown): void
  /** A value to explore interactively, with a label */
  inspect(label: string, value: unknown): void
  /** A problem, with the underlying cause when there is one */
  error(message: string, cause?: unknown): void
}

const STYLE = {
  heading: 'font-weight: bold; font-size: 13px',
  muted: 'color: gray',
  name: 'color: cyan; font-weight: bold',
  ok: 'color: green',
  warn: 'color: orange',
  bad: 'color: red',
  none: ''
} as const

/** The style names the commands use, so the sink decides how they look */
export type DevtoolsStyle = keyof typeof STYLE

/** Resolve a style name to CSS for a `%c` placeholder */
export function css(style: DevtoolsStyle): string {
  return STYLE[style]
}

/** Output through the browser console, with colours */
export function consoleOutput(): DevtoolsOutput {
  return {
    log(message, ...styles) {
      console.log(message, ...styles)
    },
    table(data) {
      console.table(data)
    },
    inspect(label, value) {
      console.log(`%c${label}`, STYLE.heading)
      console.log(value)
    },
    error(message, cause) {
      console.log(`%c${message}`, STYLE.bad)
      if (cause !== undefined) console.error(cause)
    }
  }
}

/**
 * Output collected in memory, for tests: `lines` holds the messages with the
 * `%c` markers removed, so an assertion reads like the console looks.
 */
export interface CollectingOutput extends DevtoolsOutput {
  lines: string[]
  tables: unknown[]
  inspected: Array<{ label: string; value: unknown }>
  errors: Array<{ message: string; cause?: unknown }>
  text(): string
}

export function collectingOutput(): CollectingOutput {
  const lines: string[] = []
  const tables: unknown[] = []
  const inspected: Array<{ label: string; value: unknown }> = []
  const errors: Array<{ message: string; cause?: unknown }> = []

  return {
    lines,
    tables,
    inspected,
    errors,
    log(message) {
      lines.push(message.replace(/%c/g, ''))
    },
    table(data) {
      tables.push(data)
    },
    inspect(label, value) {
      inspected.push({ label, value })
      lines.push(label)
    },
    error(message, cause) {
      errors.push({ message, cause })
      lines.push(message)
    },
    text() {
      return lines.join('\n')
    }
  }
}
