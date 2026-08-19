/** Namespaces, service IDs and the shape of the theme capability */

/** A capability that is not a service: a promise about a stylesheet */
export const THEME_NAMESPACE = 'demo.theme'

export const EDITOR_SERVICE = 'demo.editor'
export const PDF_SERVICE = 'demo.pdf'
export const LOG_SERVICE = 'demo.log'

export interface Log {
  write(source: string, message: string): void
}
