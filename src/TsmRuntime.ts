/**
 * TSM Runtime - Das globale __tsm__ Objekt
 *
 * Wird vom Host-App bereitgestellt und von Plugins genutzt.
 * Verwaltet Shared Libraries (Vue, PrimeVue, etc.)
 */

import * as semver from 'semver'

/**
 * Shared Library Registration
 */
export interface SharedLibrary {
  /** Library exports */
  exports: unknown
  /** Semver version */
  version: string
  /** Optional: wer hat registriert */
  providedBy?: string
}

/**
 * TSM Runtime Interface
 */
export interface TsmRuntime {
  /**
   * Shared Library abrufen
   * @param moduleId - Library ID (z.B. 'vue', 'primevue')
   * @throws Error wenn Library nicht registriert
   */
  require<T = unknown>(moduleId: string): T

  /**
   * Shared Library registrieren
   * @param moduleId - Library ID
   * @param exports - Die Exports der Library
   * @param version - Semver Version (z.B. "3.4.0")
   * @param providedBy - Optional: wer registriert (für Debugging)
   */
  register(moduleId: string, exports: unknown, version: string, providedBy?: string): void

  /**
   * Prüfen ob Library registriert ist
   */
  has(moduleId: string): boolean

  /**
   * Version einer Library abfragen
   */
  getVersion(moduleId: string): string | undefined

  /**
   * Prüfen ob Version kompatibel ist
   * @param moduleId - Library ID
   * @param versionRange - Semver Range (z.B. "^3.4.0")
   */
  satisfies(moduleId: string, versionRange: string): boolean

  /**
   * Alle registrierten Libraries mit Versionen
   */
  getRegistered(): Map<string, { version: string; providedBy?: string }>

  /**
   * Validiere dass alle benötigten Libraries verfügbar sind
   * @param requirements - Array von { id, versionRange }
   * @returns Validation result mit fehlenden/inkompatiblen Libraries
   */
  validate(requirements: SharedDependency[]): SharedValidationResult
}

/**
 * Shared Dependency Requirement
 */
export interface SharedDependency {
  /** Library ID (z.B. 'vue', 'primevue') */
  id: string
  /** Semver version range (z.B. '^3.4.0', '>=2.0.0') */
  versionRange: string
}

/**
 * Validation Result
 */
export interface SharedValidationResult {
  /** Alle Requirements erfüllt? */
  valid: boolean
  /** Fehlende Libraries */
  missing: string[]
  /** Inkompatible Versionen */
  incompatible: Array<{
    id: string
    required: string
    available: string
  }>
}

// Interner Storage
const sharedLibraries = new Map<string, SharedLibrary>()

/**
 * Das globale TSM Runtime Objekt
 */
export const tsmRuntime: TsmRuntime = {
  require<T = unknown>(moduleId: string): T {
    const lib = sharedLibraries.get(moduleId)
    if (!lib) {
      const available = Array.from(sharedLibraries.keys())
      throw new Error(
        `[TSM] Shared library not found: '${moduleId}'\n` +
        `Available libraries: ${available.length > 0 ? available.join(', ') : 'none'}\n` +
        `Make sure the host application has registered this library.`
      )
    }
    return lib.exports as T
  },

  register(moduleId: string, exports: unknown, version: string, providedBy?: string): void {
    // Validiere Version
    if (!semver.valid(version)) {
      throw new Error(
        `[TSM] Invalid version '${version}' for library '${moduleId}'. ` +
        `Must be valid semver (e.g., '3.4.0').`
      )
    }

    const existing = sharedLibraries.get(moduleId)
    if (existing) {
      console.warn(
        `[TSM] Overwriting shared library '${moduleId}' ` +
        `(${existing.version} → ${version})`
      )
    }

    sharedLibraries.set(moduleId, {
      exports,
      version,
      providedBy
    })

    console.debug(`[TSM] Registered: ${moduleId}@${version}${providedBy ? ` (by ${providedBy})` : ''}`)
  },

  has(moduleId: string): boolean {
    return sharedLibraries.has(moduleId)
  },

  getVersion(moduleId: string): string | undefined {
    return sharedLibraries.get(moduleId)?.version
  },

  satisfies(moduleId: string, versionRange: string): boolean {
    const lib = sharedLibraries.get(moduleId)
    if (!lib) return false
    return semver.satisfies(lib.version, versionRange)
  },

  getRegistered(): Map<string, { version: string; providedBy?: string }> {
    const result = new Map<string, { version: string; providedBy?: string }>()
    for (const [id, lib] of sharedLibraries) {
      result.set(id, { version: lib.version, providedBy: lib.providedBy })
    }
    return result
  },

  validate(requirements: SharedDependency[]): SharedValidationResult {
    const result: SharedValidationResult = {
      valid: true,
      missing: [],
      incompatible: []
    }

    for (const req of requirements) {
      const lib = sharedLibraries.get(req.id)

      if (!lib) {
        result.valid = false
        result.missing.push(req.id)
      } else if (!semver.satisfies(lib.version, req.versionRange)) {
        result.valid = false
        result.incompatible.push({
          id: req.id,
          required: req.versionRange,
          available: lib.version
        })
      }
    }

    return result
  }
}

// Global verfügbar machen
declare global {
  interface Window {
    __tsm__: TsmRuntime
  }
  // Für direkte Nutzung ohne window.
  const __tsm__: TsmRuntime
}

/**
 * TSM Runtime initialisieren und global verfügbar machen
 * Muss vom Host aufgerufen werden BEVOR Plugins geladen werden
 */
export function initTsmRuntime(): TsmRuntime {
  if (typeof window !== 'undefined') {
    if (window.__tsm__) {
      console.warn('[TSM] Runtime already initialized, returning existing instance')
      return window.__tsm__
    }
    window.__tsm__ = tsmRuntime
  }
  return tsmRuntime
}

/**
 * Prüfen ob TSM Runtime verfügbar ist
 */
export function isTsmRuntimeAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.__tsm__
}

export default tsmRuntime