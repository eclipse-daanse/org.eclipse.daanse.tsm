# TSM - TypeScript Module System

## Spezifikation v0.2.0

---

## 1. Scope & Ziele

### 1.1 Was ist TSM?

TSM ist ein **Runtime-Modul-System** für TypeScript/JavaScript-Anwendungen, das:

- **Dynamisches Laden** von Modulen zur Laufzeit ermöglicht
- **Plugin-Architekturen** unterstützt (Host + Plugins)
- **Dependency Injection** über einen Service-Container bereitstellt
- **Lifecycle-Management** für Module bietet (activate/deactivate)
- **Versionierte Abhängigkeiten** mit Semver auflöst

### 1.2 Primäre Use Cases

1. **EMFTs-Plugin-System**: Erweiterbare EMF-basierte Anwendungen
2. **Micro-Frontend-Architektur**: Unabhängig deploybare Module
3. **Plugin-Marktplätze**: Discovery und Installation von Plugins aus Repositories

### 1.3 Design-Prinzipien

| Prinzip | Beschreibung |
|---------|--------------|
| **Browser-First** | Primär für Browser-Umgebung, kein Node.js-spezifischer Code |
| **Zero Build-Time Dependencies** | Plugins werden zur Laufzeit geladen, nicht bei Build |
| **Framework-Agnostisch** | Funktioniert mit Vue, React, Angular, Vanilla JS |
| **Type-Safe** | Volle TypeScript-Unterstützung mit generischen APIs |
| **Minimal Core** | Kleiner Kern, Erweiterbarkeit durch Module selbst |

### 1.4 Nicht-Ziele (Out of Scope)

- Server-Side Module Loading (Node.js require/import)
- Build-Time Module Federation (das ist Webpack/Vite's Job)
- Package Management (kein npm/yarn Ersatz)
- Transpilation/Bundling (Module müssen bereits gebaut sein)

---

## 2. Architektur

### 2.1 Komponenten-Übersicht

```
┌─────────────────────────────────────────────────────────────────┐
│                         Host Application                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │   ModuleLoader   │  │  PluginRegistry  │  │ SharedModule  │  │
│  │                  │  │                  │  │    Loader     │  │
│  │  - register()    │  │  - addRepo()     │  │               │  │
│  │  - loadAll()     │  │  - discover()    │  │  - loadAll()  │  │
│  │  - unload()      │  │  - findModule()  │  │  - get()      │  │
│  │  - reload()      │  │  - checkUpdates()│  │               │  │
│  └────────┬─────────┘  └────────┬─────────┘  └───────────────┘  │
│           │                     │                                │
│           ▼                     ▼                                │
│  ┌──────────────────┐  ┌──────────────────┐                     │
│  │DependencyResolver│  │  ServiceRegistry │                     │
│  │                  │  │                  │                     │
│  │  - resolve()     │  │  - register()    │                     │
│  │  - detectCycles()│  │  - bind()        │                     │
│  │  - validateVer() │  │  - get()         │                     │
│  └──────────────────┘  └──────────────────┘                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP/Import
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Plugin Repositories                         │
│                                                                  │
│  https://plugins.example.com/                                   │
│  ├── index.json              (RepositoryIndex)                  │
│  ├── plugin-a/                                                  │
│  │   ├── manifest.json       (ModuleManifest)                   │
│  │   └── index.js            (Entry Point)                      │
│  └── plugin-b/                                                  │
│      ├── manifest.json                                          │
│      └── index.js                                               │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Modul-Lifecycle

```
                    register()
                        │
                        ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  registered │───▶│  resolving  │───▶│   loading   │
└─────────────┘    └─────────────┘    └─────────────┘
                                            │
                   ┌────────────────────────┘
                   ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   active    │◀───│ activating  │    │    error    │
└─────────────┘    └─────────────┘    └─────────────┘
       │                                     ▲
       │ unload()                            │
       ▼                                     │
┌─────────────┐    ┌─────────────┐           │
│deactivating │───▶│   stopped   │───────────┘
└─────────────┘    └─────────────┘   (on failure)
```

### 2.3 Datenfluss

```
1. Discovery:    PluginRegistry → fetch → RepositoryIndex → ModuleManifest[]
2. Resolution:   ModuleManifest[] → DependencyResolver → loadOrder[]
3. Loading:      loadOrder[] → ModuleLoader → dynamic import() → LoadedModule[]
4. Activation:   LoadedModule → lifecycle.activate(context) → ServiceRegistry
5. Runtime:      ServiceRegistry.get() → Service Instance
```

---

## 3. Core Types

### 3.1 ModuleManifest

```typescript
interface ModuleManifest {
  /** Unique module identifier (e.g., "@company/plugin-name") */
  id: string

  /** Human-readable name */
  name: string

  /** Semantic version (e.g., "1.2.3") */
  version: string

  /** Description */
  description?: string

  /** URL to the module entry point */
  entry: string

  /** Exported paths and their types */
  exports: Record<string, ModuleExport>

  /** Services this module provides */
  provides?: ServiceDeclaration[]

  /** Services this module requires */
  requiresService?: ServiceRequirement[]

  /** Module dependencies with optional version ranges */
  dependencies?: Dependency[]

  /** Optional dependencies */
  optionalDependencies?: Dependency[]

  /** Load priority (higher = earlier) */
  priority?: number

  /** Shared libraries required from host (e.g., vue, primevue) */
  sharedDependencies?: SharedDependency[]
}
```

### 3.2 SharedDependency

```typescript
/**
 * Shared library dependency - libraries provided by the host application
 * (e.g., Vue, PrimeVue) that plugins consume via __tsm__.require()
 */
interface SharedDependency {
  /** Library ID (e.g., 'vue', 'primevue', 'vue-router') */
  id: string

  /** Semver version range required (e.g., "^3.4.0") */
  versionRange: string
}
```

### 3.3 Dependency

```typescript
// Simple form
type Dependency = string  // "moduleA"

// Full form with version range
type Dependency = {
  id: string
  versionRange?: string  // Semver: "^1.0.0", ">=2.0.0 <3.0.0"
  optional?: boolean
}
```

### 3.4 ServiceDeclaration

```typescript
interface ServiceDeclaration {
  /** Service identifier for DI container */
  id: string

  /** Human-readable description */
  description?: string

  /** Scope: singleton (default) or transient */
  scope?: 'singleton' | 'transient'
}
```

### 3.5 ModuleLifecycle

```typescript
interface ModuleLifecycle {
  /** Called when module is activated */
  activate?(context: ModuleContext): Promise<void> | void

  /** Called when module is deactivated */
  deactivate?(context: ModuleContext): Promise<void> | void
}
```

### 3.6 ModuleContext

```typescript
interface ModuleContext {
  /** This module's manifest */
  manifest: ModuleManifest

  /** Access to other loaded modules */
  getModule<T>(moduleId: string): T | undefined

  /** Check if a module is loaded */
  isModuleLoaded(moduleId: string): boolean

  /** Service registry for DI */
  services: ServiceRegistry

  /** Logger instance */
  log: ModuleLogger
}
```

---

## 4. Public API

### 4.1 ModuleLoader

```typescript
class ModuleLoader {
  constructor(options?: ModuleLoaderOptions)

  // Registration
  register(manifests: ModuleManifest[]): void

  // Loading
  loadAll(): Promise<void>
  loadModule(manifest: ModuleManifest): Promise<LoadedModule>

  // Unloading
  unloadModule(moduleId: string): Promise<boolean>
  reloadModule(moduleId: string): Promise<void>  // requires hotReload: true

  // Queries
  isLoaded(moduleId: string): boolean
  getModule(moduleId: string): LoadedModule | undefined
  getModuleExports<T>(moduleId: string): T | undefined
  getLoadedModuleIds(): string[]
  getServiceRegistry(): ServiceRegistry

  // Events
  addEventListener(listener: ModuleEventListener): void
  removeEventListener(listener: ModuleEventListener): void
}
```

### 4.2 PluginRegistry

```typescript
class PluginRegistry {
  constructor(options?: PluginRegistryOptions)

  // Repository Management
  addRepository(repo: PluginRepository): void
  removeRepository(repoId: string): boolean
  getRepositories(): PluginRepository[]
  getRepository(repoId: string): PluginRepository | undefined

  // Discovery
  discoverAll(): Promise<DiscoveredModule[]>
  discoverFromRepository(repo: PluginRepository): Promise<DiscoveredModule[]>
  getDiscoveredModules(): DiscoveredModule[]
  getManifests(): ModuleManifest[]  // deduplicated

  // Search
  findModule(moduleId: string, versionRange?: string): DiscoveredModule | undefined
  findModuleVersions(moduleId: string): DiscoveredModule[]

  // Updates
  checkUpdates(loadedManifests: ModuleManifest[]): Promise<ModuleUpdate[]>

  // Cache
  clearCache(): void

  // Events
  addEventListener(listener: RegistryEventListener): void
  removeEventListener(listener: RegistryEventListener): void
}
```

### 4.3 ServiceRegistry

```typescript
interface ServiceRegistry {
  // Registration
  register<T>(id: string, service: T): void
  bind<T>(id: string, factory: () => T, options?: BindOptions): void

  // Retrieval
  get<T>(id: string): T | undefined
  getRequired<T>(id: string): T  // throws if not found
  getAll<T>(idPattern: string): T[]  // supports wildcards

  // Queries
  has(id: string): boolean
  checkRequirements(requirements: ServiceRequirement[]): { satisfied: boolean; missing: string[] }
  getBindingInfo(id: string): BindingInfo | undefined
  getServiceIds(): string[]

  // Lifecycle
  unregister(id: string): boolean
}
```

### 4.4 DependencyResolver

```typescript
class DependencyResolver {
  // Resolution
  resolve(modules: ModuleManifest[]): DependencyResolution

  // Version Matching
  findMatchingVersion(depSpec: DependencySpec, modules: ModuleManifest[]): ModuleManifest | undefined
  satisfies(version: string, depSpec: DependencySpec): boolean
  findCompatibleVersion(moduleId: string, constraints: string[], modules: ModuleManifest[]): string | undefined

  // Graph Analysis
  getTransitiveDependencies(moduleId: string, modules: ModuleManifest[]): string[]
  getDependents(moduleId: string, modules: ModuleManifest[]): string[]

  // Validation
  validateVersionConstraints(modules: ModuleManifest[]): VersionConflict[]
  suggestResolution(conflict: VersionConflict): string | undefined
}
```

### 4.5 SharedModuleLoader (deprecated)

> **Note:** SharedModuleLoader wird durch TsmRuntime ersetzt.

```typescript
class SharedModuleLoader {
  constructor(options?: SharedModuleLoaderOptions)
  addModule(config: SharedModuleConfig): void
  loadAll(): Promise<void>
  get<T>(name: string): T | undefined
  isShared(name: string): boolean
  isLoaded(name: string): boolean
  getSharedModuleNames(): string[]
  static getGlobal(name: string): unknown
}
```

### 4.6 TsmRuntime

Das globale `__tsm__` Objekt für Shared Library Management.

```typescript
interface TsmRuntime {
  /**
   * Shared Library abrufen
   * @throws Error wenn Library nicht registriert
   */
  require<T = unknown>(moduleId: string): T

  /**
   * Shared Library registrieren (vom Host aufgerufen)
   * @param moduleId - Library ID (z.B. 'vue', 'primevue')
   * @param exports - Die Exports der Library
   * @param version - Semver Version (z.B. "3.4.21")
   * @param providedBy - Optional: wer registriert (für Debugging)
   */
  register(moduleId: string, exports: unknown, version: string, providedBy?: string): void

  /** Prüfen ob Library registriert ist */
  has(moduleId: string): boolean

  /** Version einer Library abfragen */
  getVersion(moduleId: string): string | undefined

  /** Prüfen ob Version kompatibel ist */
  satisfies(moduleId: string, versionRange: string): boolean

  /** Alle registrierten Libraries mit Versionen */
  getRegistered(): Map<string, { version: string; providedBy?: string }>

  /** Validiere dass alle benötigten Libraries verfügbar sind */
  validate(requirements: SharedDependency[]): SharedValidationResult
}

interface SharedValidationResult {
  valid: boolean
  missing: string[]
  incompatible: Array<{
    id: string
    required: string
    available: string
  }>
}
```

**Initialisierung (Host):**

```typescript
import { initTsmRuntime } from 'tsm'
import * as Vue from 'vue'
import * as PrimeVue from 'primevue'

// 1. Runtime initialisieren (MUSS zuerst!)
const tsm = initTsmRuntime()

// 2. Libraries registrieren MIT Version
tsm.register('vue', Vue, '3.4.21')
tsm.register('vue-router', VueRouter, '4.2.5')
tsm.register('primevue', PrimeVue, '4.0.0')

// 3. Dann Plugins laden...
```

**Nutzung (Plugin):**

```typescript
// Source Code (mit tsm: Prefix)
import { ref, computed } from 'tsm:vue'
import { Button } from 'tsm:primevue'

// Nach Build (transformiert durch Vite Plugin)
const { ref, computed } = __tsm__.require('vue')
const { Button } = __tsm__.require('primevue')
```

---

## 5. Events

### 5.1 ModuleEvent

```typescript
interface ModuleEvent {
  type: 'registering' | 'loading' | 'loaded' | 'activating' | 'activated' |
        'deactivating' | 'deactivated' | 'error' | 'unloaded'
  moduleId: string
  manifest?: ModuleManifest
  error?: Error
  timestamp: Date
}
```

### 5.2 RegistryEvent

```typescript
interface RegistryEvent {
  type: 'repository-added' | 'repository-removed' | 'modules-discovered' |
        'discovery-error' | 'update-available'
  repository?: PluginRepository
  modules?: DiscoveredModule[]
  updates?: ModuleUpdate[]
  error?: Error
  timestamp: Date
}
```

### 5.3 ServiceRegistryEvent

```typescript
interface ServiceRegistryEvent {
  type: 'registered' | 'updated' | 'unregistered'
  serviceId: string
  service: unknown
}
```

---

## 6. Vite Plugin

### 6.1 tsmPlugin

Transformiert `tsm:` Imports zur Build-Zeit:

```typescript
// Input
import { ref, computed } from 'tsm:my-app/vue'
import { Button } from 'tsm:ui-library'

// Output
const { ref, computed } = __tsm__.require('my-app', 'vue');
const { Button } = __tsm__.require('ui-library');
```

### 6.2 createTsmExternals

Konfiguriert welche Packages gebündelt vs. externalisiert werden:

```typescript
// vite.config.ts
import { tsmPlugin, createTsmExternals } from 'tsm/vite'

export default defineConfig({
  plugins: [tsmPlugin()],
  build: {
    rollupOptions: {
      external: createTsmExternals('my-plugin', {
        libraryProviders: ['core-library'],  // Diese bündeln shared libs
        alwaysExternal: ['vue', 'vue-router', 'tsm'],
        sharedPackages: ['primevue', '@primevue']
      })
    }
  }
})
```

---

## 7. Repository-Struktur

### 7.1 Repository Index

`https://plugins.example.com/index.json`:

```json
{
  "name": "My Plugin Repository",
  "description": "Official plugins for MyApp",
  "version": "1",
  "modules": [
    "core-services",
    "data-viewer",
    "export-tools"
  ],
  "updatedAt": "2025-01-14T10:00:00Z"
}
```

### 7.2 Module Manifest

`https://plugins.example.com/data-viewer/manifest.json`:

```json
{
  "id": "data-viewer",
  "name": "Data Viewer Plugin",
  "version": "2.1.0",
  "description": "Visualize EMF model data",
  "entry": "index.js",
  "exports": {
    "./viewer": {
      "type": "component",
      "description": "Main viewer component"
    },
    "./api": {
      "type": "service",
      "serviceId": "data-viewer.api"
    }
  },
  "provides": [
    {
      "id": "viewer.service",
      "description": "Data viewing service",
      "scope": "singleton"
    }
  ],
  "requiresService": [
    { "id": "storage.service" },
    { "id": "auth.service", "optional": true }
  ],
  "dependencies": [
    "core-services",
    { "id": "ui-library", "versionRange": "^3.0.0" }
  ],
  "sharedDependencies": [
    { "id": "vue", "versionRange": "^3.4.0" },
    { "id": "vue-router", "versionRange": "^4.0.0" },
    { "id": "primevue", "versionRange": "^4.0.0" }
  ],
  "priority": 10
}
```

---

## 8. Integration mit EMFTs

### 8.1 EMFTs-Service-Integration

TSM stellt Services bereit, die EMFTs-Komponenten nutzen können:

```typescript
// Plugin: emfts-storage-plugin
export function activate(context: ModuleContext) {
  const resourceSet = new BasicResourceSet()

  context.services.bind('emfts.resourceSet', () => resourceSet, {
    scope: 'singleton',
    providedBy: context.manifest.id
  })

  context.services.bind('emfts.packageRegistry', () => EPackageRegistry.INSTANCE, {
    scope: 'singleton'
  })
}
```

### 8.2 Geplante EMFTs-Services

| Service ID | Beschreibung |
|------------|--------------|
| `emfts.resourceSet` | Zentrale ResourceSet-Instanz |
| `emfts.packageRegistry` | EPackage-Registry |
| `emfts.factoryRegistry` | EFactory-Registry |
| `emfts.xmlResource.factory` | Factory für XMLResource |
| `emfts.validation` | Validierungs-Service |

### 8.3 Extension Points (geplant)

```typescript
interface ExtensionPoint<T> {
  id: string
  description: string
  schema?: unknown  // JSON Schema for validation
}

// Host definiert Extension Points
const editorExtensions: ExtensionPoint<EditorExtension> = {
  id: 'editor.extensions',
  description: 'Editor toolbar and panel extensions'
}

// Plugins registrieren Extensions
context.services.register('editor.extensions', {
  toolbarItems: [...],
  panels: [...]
})
```

---

## 9. Fehlende Features / Roadmap

### 9.1 Kritisch (v0.2.0)

- [ ] **Permissions-System**: Module sollen deklarieren welche APIs sie nutzen
- [ ] **Sandbox-Isolation**: Optional isolierte Ausführung für untrusted Plugins
- [ ] **Error Boundaries**: Fehler in Plugins sollten Host nicht crashen

### 9.2 Wichtig (v0.3.0)

- [ ] **Extension Points**: Formales System für Plugin-Erweiterungen
- [ ] **Config-System**: Module sollen Konfiguration deklarieren können
- [ ] **Lazy Loading**: Module erst laden wenn benötigt
- [ ] **Preloading**: Wichtige Module im Hintergrund vorladen

### 9.3 Nice-to-Have (v1.0.0)

- [ ] **DevTools**: Browser-Extension für Debugging
- [ ] **Metrics**: Performance-Monitoring für Module
- [ ] **A/B Testing**: Verschiedene Versionen parallel testen
- [ ] **Rollback**: Automatisches Rollback bei Fehlern

### 9.4 Bekannte Limitierungen

1. **Kein SSR**: Nur Browser-Umgebung unterstützt
2. **Keine Circular Deps**: Zyklische Abhängigkeiten werden erkannt aber nicht aufgelöst
3. **Kein Tree-Shaking**: Komplette Module werden geladen
4. **Single Version**: Pro Modul-ID nur eine Version zur Laufzeit

---

## 10. Beispiel: Kompletter Flow

```typescript
// 1. Host Application Setup
import { initTsmRuntime, ModuleLoader, PluginRegistry } from 'tsm'
import * as Vue from 'vue'
import * as VueRouter from 'vue-router'
import * as PrimeVue from 'primevue'

// 1a. TSM Runtime initialisieren (MUSS ZUERST!)
const tsm = initTsmRuntime()

// 1b. Shared Libraries registrieren MIT Versionen
tsm.register('vue', Vue, '3.4.21')
tsm.register('vue-router', VueRouter, '4.2.5')
tsm.register('primevue', PrimeVue, '4.0.0')

console.log('Registered shared libraries:', tsm.getRegistered())

// 2. Plugin Registry konfigurieren
const registry = new PluginRegistry()
registry.addRepository({
  id: 'official',
  name: 'Official Plugins',
  url: 'https://plugins.myapp.com',
  priority: 100
})

// 3. Module Loader erstellen
const loader = new ModuleLoader({
  hotReload: true,
  continueOnError: true
})

// Events abonnieren
loader.addEventListener({
  onModuleEvent(event) {
    console.log(`[${event.type}] ${event.moduleId}`)
    if (event.type === 'error') {
      console.error('Module error:', event.error)
    }
  }
})

// 4. Discovery & Loading
const discovered = await registry.discoverAll()
console.log(`Found ${discovered.length} plugins`)

// Manifests registrieren
loader.register(registry.getManifests())

// Alle Module laden (validiert sharedDependencies automatisch!)
await loader.loadAll()

// 5. Services nutzen
const services = loader.getServiceRegistry()
const resourceSet = services.getRequired<ResourceSet>('emfts.resourceSet')
const viewer = services.get<ViewerService>('viewer.service')

// 6. Hot Reload (bei Änderungen)
await loader.reloadModule('data-viewer')

// 7. Updates prüfen
const updates = await registry.checkUpdates(
  loader.getLoadedModuleIds().map(id => loader.getModule(id)!.manifest)
)
if (updates.length > 0) {
  console.log('Updates available:', updates)
}
```

---

## 11. Konfiguration

### 11.1 ModuleLoaderOptions

```typescript
interface ModuleLoaderOptions {
  /** Timeout für Modul-Loading (ms) - Default: 10000 */
  loadTimeout?: number

  /** Bei Fehler mit anderen Modulen fortfahren - Default: true */
  continueOnError?: boolean

  /** Hot Reload aktivieren - Default: false */
  hotReload?: boolean

  /** Custom ServiceRegistry */
  serviceRegistry?: ServiceRegistry

  /** Custom Logger */
  logger?: ModuleLogger
}
```

### 11.2 PluginRegistryOptions

```typescript
interface PluginRegistryOptions {
  /** Timeout für fetch (ms) - Default: 10000 */
  fetchTimeout?: number

  /** Custom fetch function */
  fetchFn?: typeof fetch

  /** Logger */
  logger?: ModuleLogger

  /** Cache TTL (ms), 0 = kein Cache - Default: 300000 (5 min) */
  cacheTtl?: number
}
```

---

## 12. Versioning & Kompatibilität

### 12.1 TSM Versioning

TSM folgt Semantic Versioning:
- **MAJOR**: Breaking API changes
- **MINOR**: Neue Features, backwards-compatible
- **PATCH**: Bug fixes

### 12.2 Manifest-Schema-Version

```json
{
  "$schema": "https://tsm.dev/schema/manifest/v1.json",
  "id": "my-plugin",
  ...
}
```

### 12.3 Dependency Resolution Rules

1. **Höchste kompatible Version** wird bevorzugt
2. **Repository-Priority** entscheidet bei gleicher Version
3. **Version Conflicts** werden gemeldet, nicht automatisch aufgelöst
4. **Optional Dependencies** werden ignoriert wenn nicht verfügbar

---

## Changelog

### v0.1.0
- Initial implementation
- ModuleLoader mit Lifecycle
- PluginRegistry mit Discovery
- DependencyResolver mit Semver
- ServiceRegistry (Singleton/Transient)
- SharedModuleLoader
- Vite Plugin

### v0.2.0 (aktuell)
- **TsmRuntime**: Globales `__tsm__` Objekt für Shared Libraries
- **sharedDependencies**: Manifest-Feld für Host-Libraries mit Versionen
- **Validierung**: Automatische Prüfung ob Shared Libraries verfügbar/kompatibel
- SharedModuleLoader als deprecated markiert

### v0.3.0 (geplant)
- Permissions-System
- Extension Points
- Verbesserte Fehlerbehandlung
- Config-System für Module