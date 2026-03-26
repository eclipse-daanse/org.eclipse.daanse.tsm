/**
 * Core Module - Type Definitions
 * Diese Datei wird von der IDE für Autocomplete verwendet
 */

export declare const name: string
export declare const version: string

export declare class CoreService {
  initialized: boolean
  initialize(): void
  getMessage(): string
}

export declare function activate(context: import('tsm').ModuleContext): Promise<void>
export declare function deactivate(context: import('tsm').ModuleContext): Promise<void>
