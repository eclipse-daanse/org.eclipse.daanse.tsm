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
  loadModule(
    manifest: ModuleManifest,
    options?: { awaitCascade?: boolean }
  ): Promise<LoadedModule>

  // Unloading
  unloadModule(moduleId: string): Promise<boolean>
  reloadModule(moduleId: string): Promise<void>  // requires hotReload: true

  // On/off, a dimension of its own: a disabled module is not broken and not
  // waiting, it is switched off
  disableModule(moduleId: string): Promise<boolean>
  enableModule(moduleId: string): Promise<boolean>
  isDisabled(moduleId: string): boolean
  getDisabledModules(): string[]

  // Queries
  isLoaded(moduleId: string): boolean
  getModule(moduleId: string): LoadedModule | undefined
  getModuleExports<T>(moduleId: string): T | undefined
  getLoadedModuleIds(): string[]
  getManifests(): ModuleManifest[]
  getServiceRegistry(): ServiceRegistry

  // Diagnosis
  getUnsatisfiedModules(): Array<{ moduleId: string; waitingFor: string[] }>
  getDeclarationMismatches(): Array<{ moduleId: string; serviceIds: string[] }>
  getServiceConsumers(serviceId: string): Array<{ moduleId: string; state: ModuleState; requirement: ServiceRequirement }>
  getComponents(moduleId?: string): ComponentInfo[]

  // Reactions to service and configuration events run in a queue; this waits
  // for it, including what a reaction caused. Never call it from a hook.
  settle(): Promise<void>

  // Events
  addEventListener(listener: ModuleEventListener): void
  removeEventListener(listener: ModuleEventListener): void

  dispose(): void
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

### 6.2 Geteilte Bibliotheken

Eine Bibliothek, die alle Module teilen sollen, muss **eine** Instanz sein. Zwei
Kopien von Vue heißen zwei Reaktivitätssysteme: `provide`/`inject` trägt nicht über
die Grenze, Komponenten aus dem einen lassen sich im anderen nicht rendern. Und
anders als in Java gibt es keinen Verifier, der das meldet — es verhält sich
still falsch.

Deshalb entscheidet das **Manifest**, und der Build muss sich daran halten:

```typescript
// vite.config.ts
import { tsmPlugin, createTsmExternals } from '@eclipse-daanse/tsm/vite'
import manifest from './manifest.json'

export default defineConfig({
  plugins: [tsmPlugin({ manifest })],
  build: {
    rollupOptions: {
      external: createTsmExternals(manifest)
    }
  }
})
```

`createTsmExternals(manifest)` externalisiert, was in `sharedDependencies` steht
(samt Unterpfaden wie `vue/dist/…`) plus tsm selbst; alles andere wird gebündelt.
Ein Modul, das eine Bibliothek *bereitstellt*, führt sie nicht in seinen eigenen
`sharedDependencies` — und bündelt sie damit von selbst.

**Der Build scheitert, wenn eine deklarierte Bibliothek doch im Bundle landet.**
`tsmPlugin({ manifest })` sucht in den Chunks nach Modulpfaden unter
`node_modules/<lib>/`; ein Treffer beweist, dass die Externalisierung nicht griff.
Das ist der einzige Zeitpunkt, an dem dieser Fehler feststellbar ist — zur Laufzeit
prüft `validateSharedDependencies` nur, ob der *Host* die Bibliothek hat, nicht ob
das Modul sie benutzt.

Die ältere Form `createTsmExternals('modul-id', { libraryProviders, sharedPackages })`
gilt weiter, entscheidet aber aus Listen in der Build-Konfiguration statt aus dem
Manifest.

### 6.3 Import Maps statt `__tsm__.require()`

`__tsm__.require()` ist ein Module-Federation-Erbe: der Vite-Plugin schreibt
`import { ref } from 'vue'` in einen Zugriff auf eine globale Registry um. Der
Standardweg dafür sind **Import Maps** — dann bleibt der Import ein Import, und der
Host bestimmt nur die URL:

```typescript
import { generateImportMap, installImportMap } from '@eclipse-daanse/tsm'

const { importMap, missing, incompatible } = generateImportMap(manifests, {
  vue: { url: '/libs/vue.esm-browser.js', version: '3.5.13' },
  d3: '/libs/d3.js'
})

if (missing.length > 0 || incompatible.length > 0) {
  throw new Error('Die angebotenen Bibliotheken passen nicht zu den Modulen')
}

installImportMap(importMap)   // vor dem ersten Modul-Import
const loader = new ModuleLoader({ sharedLibraries: 'import-map' })
```

Eine Import Map bildet Namen auf URLs ab und weiß nichts von `^3.4.0`. Die Prüfung
muss also **vorher** passieren, und genau das tut `generateImportMap`: es liest die
`sharedDependencies` aller Manifeste und meldet, was fehlt (`missing`) oder in einer
unpassenden Version angeboten wird (`incompatible`). Mit
`sharedLibraries: 'import-map'` prüft der Loader nichts mehr — es gibt zu diesem
Zeitpunkt nichts, was er fragen könnte.

**Zwei Grenzen, beide aus dem Browser:**

- Eine Import Map wird **einmal** gelesen, bevor der erste Spezifikator aufgelöst
  wird. `installImportMap` muss also laufen, bevor irgendein Modul importiert wird,
  und weigert sich, eine zweite Map hinzuzufügen. Eine Bibliothek nachträglich
  ergänzen geht nicht — die Map gehört an den Anfang der Seite oder ins HTML.
- `scopes` werden **nicht** generiert. Sie könnten einem Modul eine andere Version
  geben als einem anderen — das nächstverwandte zu OSGis Package Wiring —, aber
  genau das will man bei geteilten Bibliotheken nicht: zwei Instanzen sind das
  Problem, das das Teilen löst. Der Typ lässt sie zu, damit ein Host sie bewusst
  setzen kann.

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
- [x] **Config-System**: Konfiguration pro Component über PIDs (§11.3)
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

  /**
   * Aktivierung mit fehlendem Pflicht-Service scheitern lassen, statt das Modul
   * in `unsatisfied` zu parken - Default: false (das Modul wartet)
   */
  strictRequirements?: boolean

  /** Custom Logger */
  logger?: ModuleLogger

  /**
   * Woher Component-Konfiguration kommt (§11.3). Ohne ihn bleiben Components
   * mit `configurationPolicy: 'require'` unerfüllt; der Admin wird zusätzlich
   * als Service `tsm.configuration.admin` veröffentlicht.
   */
  configurationAdmin?: ConfigurationAdmin
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

### 11.3 Konfiguration

Konfiguration hängt an der **Component**, nicht am Modul — wie in OSGi, wo
Configuration Admin (Compendium 104) die Werte verwaltet und DS (112) den
Lebenszyklus daran hängt. Beide Rollen sind auch hier getrennt: der
`ConfigurationAdmin` weiß nichts von Components, die Kopplung läuft über PIDs.

```typescript
import { ConfigurationAdmin, LocalStorageConfigurationStore, ModuleLoader } from '@eclipse-daanse/tsm'

const configuration = new ConfigurationAdmin({
  store: new LocalStorageConfigurationStore()
})
const loader = new ModuleLoader({ configurationAdmin: configuration })
```

Ohne `configurationAdmin` verhält sich alles wie ohne Konfiguration: Components
mit `configurationPolicy: 'require'` bleiben unerfüllt, alle anderen laufen.

#### Deklaration

```typescript
@component({
  service: ['demo.tiles'],
  configurationPid: 'demo.tiles',      // Default: der Klassenname
  configurationPolicy: 'require'       // Default: 'optional'
})
export class RasterTiles {
  private url = ''

  @activate()
  start(context: ComponentContext<TileConfig>): void {
    this.url = context.configuration.tileUrl
  }

  @modified()
  update(context: ComponentContext<TileConfig>): void {
    this.url = context.configuration.tileUrl   // ohne Neuaufbau
  }
}
```

| `configurationPolicy` | Bedeutung |
| --- | --- |
| `optional` (Default) | läuft mit Konfiguration, wenn es eine gibt, sonst ohne |
| `require` | wird nicht registriert, bis die PID existiert |
| `ignore` | liest keine Konfiguration und reagiert nicht auf Änderungen |

Mehrere PIDs (`configurationPid: ['demo.shared', 'demo.tiles']`) werden von links
nach rechts gemergt, wie in DS 1.3: eine gemeinsame PID trägt die Grundwerte, eine
spezifische überschreibt sie.

#### Was eine Änderung auslöst

Drei Fälle, in der Reihenfolge, in der DS sie unterscheidet:

1. **Component nie erzeugt** (delayed, niemand hat sie aufgelöst) — nur die
   Service-Properties werden aktualisiert. Kein Neuaufbau, weil es nichts
   aufzubauen gibt.
2. **`@modified()` vorhanden** — die Methode wird gerufen, die Instanz bleibt,
   die Service-Properties werden über `ServiceRegistration.setProperties`
   aktualisiert. Consumer behalten ihre Referenz.
3. **kein `@modified()`** — `@deactivate`, Abmeldung, Neuaufbau mit den neuen
   Werten. Das ist der Grund, `@modified()` zu schreiben: wenn ein Neuaufbau
   etwas kostet, das die Component nicht billig wiederherstellt.

Eine erneute Zustellung, die keinen Wert ändert, tut nichts.

#### Properties

Die Konfiguration wird über die Component-Properties gemergt und **wird** zu den
Service-Properties — Konfiguration gewinnt, sie ist das spätere Wort zur selben
Frage:

```typescript
@component({ service: ['demo.tiles'], properties: { kind: 'raster' } })
// Konfiguration { kind: 'vector' }  =>  Consumer mit Filter (kind=vector) trifft zu
```

Zwei Sonderfälle, beide wie in OSGi:

- Schlüssel mit führendem Punkt (`.token`) bleiben privat: die Component sieht
  sie in `context.configuration`, die Service-Properties nicht.
- `service.ranking` aus der Konfiguration überschreibt das im Code deklarierte
  Ranking — damit lässt sich die Reihenfolge zweier Provider ohne Code-Änderung
  umstellen.

Deshalb sind Konfigurationswerte auf `string`, `number`, `boolean` und Arrays
davon beschränkt: sie müssen filterbar und persistierbar sein.

#### Factory-Konfigurationen

Zeigt die PID auf eine **Factory-PID**, wird die Component einmal *pro
Konfiguration* instanziiert — jede mit eigenen Properties und eigener
Service-Registrierung. Das ist kein zusätzliches Feature, sondern dieselbe
Mechanik: in DS folgt es ebenfalls allein aus der PID.

```typescript
configuration.getFactoryConfiguration('demo.tile-source', 'osm').update({ name: 'osm', url: '…' })
configuration.getFactoryConfiguration('demo.tile-source', 'sat').update({ name: 'sat', url: '…' })
// => zwei Instanzen unter 'demo.tiles', unterscheidbar per (name=sat),
//    konsumierbar über cardinality '0..n'
```

Die PID einer benannten Factory-Konfiguration ist `factoryPid~name` wie in CM 1.6;
`createFactoryConfiguration(factoryPid)` erzeugt einen Namen selbst.

#### Persistenz

`ConfigurationStore` ist die einzige austauschbare Stelle — genau der Schnitt der
OSGi-Spezifikation, die Persistenz *verlangt* und das Medium offenlässt. Mit
dabei sind `MemoryConfigurationStore` und `LocalStorageConfigurationStore` (ein
Eintrag pro PID, damit zwei Tabs sich nicht überschreiben); ein Store gegen ein
Backend sind drei Methoden.

`loadAll()` wartet auf `ConfigurationAdmin.ready()`, damit eine Component, deren
Werte schon im Store liegen, nicht erst geparkt und dann geweckt wird.

#### Zustellung ist asynchron

`update()` kehrt zurück, sobald die Werte gespeichert und das Event abgesetzt ist
— nicht, wenn alle Components reagiert haben; auch das wie in OSGi. Die Reaktion
läuft in der Reconciliation-Queue des Loaders, also wartet `await loader.settle()`
darauf.

#### Sichtbarkeit

`loader.getComponents()` zeigt die Deklaration *und* ihre Ausprägungen — DS'
Unterscheidung zwischen Component *Description* und Component *Configuration*:

```typescript
loader.getComponents('tiles')
// [{ className: 'RasterTiles', configurationPid: ['demo.tiles'],
//    configurationPolicy: 'require', hasModified: true,
//    configurations: [{ pid: 'demo.tiles', state: 'active', properties: {…} }] }]
```

Zustände einer Ausprägung: `unsatisfied-configuration`, `satisfied` (registriert,
noch nicht erzeugt), `active`. Feiner unterscheidet DS zusätzlich
`UNSATISFIED_REFERENCE` — dafür gibt es hier kein Gegenstück, weil ein fehlender
**Service** das ganze Modul parkt (§3) und nicht die einzelne Component.

In der Konsole: `tsm.components()`, `tsm.config()`, `tsm.configure(pid, values)`,
`tsm.unconfigure(pid)`.

#### Der Admin als Service

Der Loader registriert den übergebenen Admin unter `tsm.configuration.admin`, wie
OSGi ihn als Service veröffentlicht. Ein Modul kann Konfiguration also lesen und
schreiben, ohne einen privaten Kanal zum Host:

```typescript
const configuration = context.services.get<ConfigurationAdmin>('tsm.configuration.admin')
await configuration?.getConfiguration('demo.tiles').update({ tileUrl: url })
```

#### Grenzen

- **Kein Target-Filter-Override.** DS erlaubt es, `<referenz>.target`,
  `<referenz>.cardinality` und `minimum.cardinality` per Konfiguration zu
  überschreiben. Hier stehen Requirements im Manifest und gelten für das **Modul**,
  während Konfiguration an der **Component** hängt — ein Override hätte also keinen
  eindeutigen Adressaten. Auf Code-Ebene ist es keine Einschränkung:
  `getServiceReferences(id, target)` nimmt jeden zur Laufzeit gebildeten Filter.
- **Metatype** ist in §11.4 beschrieben.
- **Kein Bundle-Location-Binding und keine Permissions.** In OSGi verhindert die
  Bindung einer Configuration an eine Bundle-Location, dass ein fremdes Bundle
  fremde Konfiguration bekommt. Im Browser gibt es keine Sicherheitsgrenze
  zwischen Modulen, gegen die das schützen würde.
- **Kein `ConfigurationPlugin`.** Werte werden zugestellt, wie sie gespeichert
  sind; Variablenersetzung gehört in den Store.

---

### 11.4 Metatype: was eine Konfiguration ist

Konfiguration beschreibt sich selbst — Namen, Typen, Defaults, Grenzen. Das ist in
OSGi der **Metatype Service** (Compendium 105), damit eine generische Oberfläche
ein Formular für eine PID anbieten kann, für die niemand ein Formular geschrieben
hat.

Ein Punkt fällt hier besser aus als in Java. Dort braucht eine Konfiguration ein
annotiertes **Interface** für den Typ und **Annotationen** für die Beschreibung,
und beide können auseinanderlaufen. Hier ist ein Schema ein Wert, und der Typ wird
daraus abgeleitet:

```typescript
export const TileSchema = objectClass({
  id: 'demo.tiles',
  name: 'Raster tiles',
  attributes: {
    url: { type: 'string', name: 'Tile URL', minLength: 8 },
    zoom: { type: 'integer', name: 'Maximum zoom', default: 19, min: 1, max: 22 },
    retina: { type: 'boolean', default: false },
    token: { type: 'password', required: false }
  }
})

export type TileConfig = ConfigurationOf<typeof TileSchema>
// { url: string; zoom: number; retina: boolean; token?: string }
```

Angemeldet wird es an der Component — OSGi's `@Designate`:

```typescript
@component({
  service: [TILE_SERVICE],
  configurationPid: 'demo.tiles',
  configurationSchema: TileSchema,
  configurationFactory: false   // true: die PID ist eine Factory-PID
})
export class RasterTiles {
  @activate()
  start(context: ComponentContext<TileConfig>): void {
    initialise(context.configuration.url, context.configuration.zoom)
  }
}
```

#### Attribute

| Feld | Bedeutung |
| --- | --- |
| `type` | `string`, `number`, `integer`, `boolean`, `password`. OSGi unterscheidet acht numerische Typen, weil Java das tut; in JavaScript bleibt von der Unterscheidung nur, ob Bruchteile erlaubt sind |
| `required` | **Default `true`**, wie in OSGi — die überraschende Vorgabe. Ein deklarierter Default vertritt den Wert |
| `default` | wird als Component-Property angewendet, siehe unten |
| `cardinality` | `single` (Default), `many`, oder eine Zahl als Höchstlänge |
| `min` / `max` | für Zahlen |
| `minLength` / `maxLength` | für Text. OSGi vergleicht `min`/`max` hier lexikographisch, was wenig nützt |
| `options` | die erlaubten Werte, mit Labels — eine Auswahlliste |
| `validate(value)` | was die Deklaration nicht ausdrücken kann; Meldung oder `undefined` |
| `name` / `description` | Labels; `%key` wird über `localization` aufgelöst |

#### Was das Framework damit tut

Zwei Dinge, und beide sind spürbar:

**Defaults wirken.** `configurationsFor()` legt die deklarierten Defaults unter die
Konfiguration, so wie bnd die Defaults eines annotierten Konfigurationstyps als
Component-Properties in den Descriptor schreibt. Die Component liest also einen
Wert und muss keinen erfinden — im Beispiel steht deshalb nirgends `?? 1000`:

```typescript
@activate()
start(context: ComponentContext<ClockConfig>): void {
  this.restartTimer(context.configuration.interval)   // immer gesetzt
}
```

Sie werden damit auch zu Service-Properties, ein Consumer kann also auf einen Wert
filtern, den niemand konfiguriert hat.

**Werte werden geprüft.** Bekommt der `ConfigurationAdmin` die Registry, weist er
ein `update()` zurück, das nicht zum Schema passt:

```typescript
const metatype = new MetatypeRegistry()
const configuration = new ConfigurationAdmin({ store, metatype })
const loader = new ModuleLoader({ configurationAdmin: configuration, metatype })
```

Das ist eine **bewusste Abweichung**: In OSGi validiert Config Admin nicht, und
Metatype beschreibt nur — geprüft wird in der Oberfläche, die schreibt. Ein
falscher Wert an der Quelle abzulehnen ist mehr wert als diese Symmetrie, und ohne
Registry ändert sich nichts.

Beides ist opt-in: ohne `metatype` verhält sich alles wie vorher.

#### Sichtbarkeit

`MetatypeRegistry` ist selbst ein Service (`tsm.metatype`), eine
Konfigurations-Oberfläche kann also ein Modul sein. `getPids()`,
`getFactoryPids()`, `getObjectClassDefinition(pid, locale?)`, `defaults(pid)`,
`validate(pid, values)`, `coerce(pid, values)`. In der Konsole:
`tsm.describe(pid)` — Attribute mit Typen, Grenzen, aktuellen Werten und dem, was
gerade nicht passt.

Lokalisierung folgt OSGi's Mechanismus: `%key` in Namen und Beschreibungen,
aufgelöst über `localization` pro Locale. Ein Key ohne Übersetzung behält seine
`%key`-Form — ein sichtbarer Platzhalter ist leichter zu beheben als ein leeres
Label.

#### Anschluss an EMF: JSON Schema als Zwischenformat

`ObjectClassDefinition`/`AttributeDefinition` und Ecore `EClass`/`EAttribute`
beschreiben dasselbe. Statt einen eigenen Ecore-Generator zu bauen, gibt tsm
**JSON Schema** aus; den Rest erledigt `@emfts/codec.jsonschema`, das bereits in
beide Richtungen konvertiert:

```typescript
import { toMetamodelSchema } from '@eclipse-daanse/tsm'
import { JsonSchemaToEPackageConverter } from '@emfts/codec.jsonschema'

const ePackage = new JsonSchemaToEPackageConverter().convert(
  toMetamodelSchema(metatype, { id: 'http://example.com/config', name: 'demoConfig' })
)
```

Damit rendern `@emfts/vue-registry` (Default-Editoren pro EDataType) oder
`@emfts/uimodel-composer` die Oberfläche — tsm braucht dafür keine Zeile
UI-Code und keine Abhängigkeit auf EMFTs.

Zwei Formen, weil es zwei Fragen sind:

| | |
| --- | --- |
| `toJsonSchema(ocd)` | beschreibt **ein Dokument** — wie die Werte einer PID aussehen. Das will ein Validator oder eine Formular-Bibliothek |
| `toMetamodelSchema(registry \| ocds)` | beschreibt **Klassen** unter `$defs`. Das liest ein EPackage-Konverter; ein Top-Level-Objektschema ignoriert er |

Die Abbildung ist erstaunlich direkt, weil beide Vokabulare Datenformen
beschreiben:

| tsm | JSON Schema | daraus in Ecore |
| --- | --- | --- |
| `type: 'string' \| 'integer' \| 'number' \| 'boolean'` | `type`, gleich benannt | `EString`, `EInt`, `EDouble`, `EBoolean` |
| `type: 'password'` | `type: 'string', format: 'password'` | `EString` |
| `cardinality: 'many'` / `n` | `type: 'array'`, `maxItems: n` | `upperBound` |
| `required` ohne `default` | `required: [...]` | `lowerBound: 1` |
| `min`/`max`, `minLength`/`maxLength` | `minimum`/`maximum`, `minLength`/`maxLength` | — |
| `options` | `enum`, als benanntes `$defs` mit `$ref` | `EEnum` mit `ELiterals` |

Ein Durchlauf mit dem echten Konverter ergibt aus den Schemata des Beispiels:

```
EPackage demoConfig (http://example.com/tsm/config)
  BasicEClass DemoTiles
    url: EString [1..1]
    zoom: EInt [0..1]
    retina: EBoolean [0..1]
    token: EString [0..1]
  BasicEEnum DemoTileSourceKind
    literal raster
    literal vector
  BasicEClass DemoTileSource
    name: EString [1..1]
    kind: DemoTileSourceKind [0..1]
```

**Grenzen dieses Wegs**, alle drei bewusst und benannt:

- `validate()` ist eine Funktion und in keinem Schema darstellbar. Erhalten bleibt
  nur, *dass* geprüft wird — als `x-tsm-validated`. Der modellseitige Ort für so
  eine Regel wäre ein OCL-Constraint.
- `localization` hat in JSON Schema keine Entsprechung. Ohne `locale` reist die
  Tabelle als `x-tsm-localization` mit, mit `locale` sind die Labels schon
  aufgelöst.
- Defaults erreichen das EPackage nicht als `defaultValueLiteral` — der Konverter
  überträgt `default` derzeit nicht. Im JSON Schema stehen sie.

Der PID-Name überlebt als `x-tsm-object-class`, weil `demo.tile-source` kein
Klassenname ist und zu `DemoTileSource` wird.

**Der verlustfreie Weg** ist `@emfts/tsm-metatype`, das ein
`ObjectClassDefinition` direkt in ein EPackage übersetzt und dabei nichts abgeben
muss: Defaults landen in `defaultValueLiteral`, Wertgrenzen und Übersetzungen in
EAnnotations, `validate()` als benannter Constraint dort, wo ein `EValidator` ihn
sucht, und `password` als eigener `EDataType`. Das Paket liegt auf der
EMFTs-Seite, wo `@emfts/core` schon zu Hause ist; von tsm importiert es nur
Typen, sodass eine Formatänderung dort einen Typfehler auslöst statt ein
Attribut stillschweigend zu verlieren. tsm bleibt damit frei von EMFTs.

Beides hat seinen Platz: JSON Schema für Validatoren, JSON Forms und
Dokumentation, der direkte Weg für ein Modell, das die Deklaration vollständig
trägt.

---

### 11.4a Requirements und Capabilities

Das allgemeine Abhängigkeitsmodell von OSGi Core 3.3: Ein Modul bietet
**Capabilities** in einem Namespace, und **Requirements** behaupten, dass eine
solche Capability existiert.

```json
{
  "id": "app",
  "capabilities": [
    { "namespace": "demo.theme", "attributes": { "name": "dark", "version": "2.1.0" } }
  ],
  "requirements": [
    { "namespace": "demo.engine", "filter": "(kind=vector)", "versionRange": "^2.0.0" }
  ]
}
```

#### Resolution ist statisch

Der entscheidende Unterschied zu `requiresService`: Resolution liest **Manifeste**
und beantwortet, ob ein Modul überhaupt laufen *könnte* — bevor irgendetwas geladen
ist. Dass ein versprochener Service zur Laufzeit wirklich registriert wird, ist
eine andere Frage. Die Spezifikation zieht dieselbe Linie: eine Capability im
Namespace `osgi.service` ist zur Resolve-Zeit „a promise" (Compendium 135.4).

Daraus folgt der praktische Gewinn — die Unterscheidung, die vorher fehlte:

| | |
| --- | --- |
| `getUnsatisfiedModules()` | ein Modul **wartet** auf einen Service |
| `getUnresolvedModules()` | ein Modul wartet **vergeblich**, weil kein Manifest das Verlangte überhaupt verspricht |

#### Ein Mechanismus statt vier

Was das Manifest bisher an drei Stellen sagte, wird abgeleitet statt danebengelegt:

| Manifest | wird zu |
| --- | --- |
| jedes Modul | Capability `osgi.identity` mit `osgi.identity`, `type`, `version` |
| `provides` | Capability `osgi.service` mit `objectClass` und den deklarierten Properties |
| `dependencies` | Requirement `osgi.identity` mit Filter und `versionRange` |
| `optionalDependencies` | dasselbe mit `resolution: 'optional'` |
| `requiresService` | Requirement `osgi.service`; `optional` und Kardinalität `0..n` werden `optional`, weil das Modul dann auch ohne Provider läuft |
| `sharedDependencies` | Requirement `tsm.library` |

Beide Wege bleiben gültig; `capabilities`/`requirements` sind die allgemeine Form,
kein Ersatz.

#### Direktiven

| | |
| --- | --- |
| `resolution` | `mandatory` (Default) oder `optional` |
| `cardinality` | `single` (Default) oder `multiple` |
| `filter` | LDAP über die Attribute **einer** Capability — `(&(a=1)(b=2))` muss von einer erfüllt werden, nicht von zwei, die je die Hälfte tragen |
| `effective` | nur `resolve` (Default) wird vom Resolver betrachtet |

Zwei Abweichungen, beide bewusst:

- **Attributnamen im Filter sind case-sensitiv** — so verlangt es Core 3.3.6, im
  Unterschied zu Service-Properties. `createServiceFilter(expr, { caseSensitive: true })`.
- **`versionRange` statt Version im Filter.** OSGi drückt Versionen im Filter aus;
  ein Filter vergleicht aber Text, und damit wäre `(version>=1.9.0)` für `1.10.0`
  nur zufällig richtig. `versionRange` ist ein Semver-Range und wird gegen das
  Attribut `version` geprüft — der Filter bleibt daneben gültig.

#### Was fehlt, und warum

Package-Wiring (`Import-Package`/`Export-Package`) hat kein Gegenstück: ES-Module
lösen ihre Importe selbst auf. Damit entfallen auch `uses`-Constraints und
Klassenraum-Konsistenz (Core 3.7), Fragmente und Refresh — sie setzen einen
Klassenlader voraus. Die Provider-Auswahl (Core 3.7.10) ist auf „höchste Version
gewinnt" reduziert; ein vollständiger Constraint-Solver löst Probleme, die ohne
Package-Wiring nicht entstehen.

In der Konsole: `tsm.capabilities(ns?)`, `tsm.wiring(id)`, `tsm.unresolved()`.

### 11.5 Konformität

[`docs/CONFORMANCE.md`](docs/CONFORMANCE.md) stellt Abschnitt für Abschnitt
gegenüber, was tsm von OSGi Release 8 umsetzt und wo es abweicht — mit der Art der
Abweichung: **Sprache** (folgt aus TypeScript statt Java), **Plattform** (Browser
statt JVM), **Laufzeit** (asynchrones Modul-Laden), **Modell** (Satisfaction pro
Modul statt pro Component), **Absicht** oder **Lücke**.

Von 120 verglichenen Punkten sind 50 konform, 44 anders und 26 nicht vorhanden.
Von den 70 Abweichungen sind die meisten keine Wahl: 17 folgen aus der Sprache,
13 aus der Plattform, 2 aus dem Laufzeitmodell, 9 aus dem Modulschnitt, 16 sind
begründete Entscheidungen — und **7 sind echte Lücken**.

### 11.6 Die Spezifikationen zum Nachlesen

Die Kapitel, auf die sich tsm bezieht, liegen unter
[`docs/osgi/`](docs/osgi/) — OSGi Release 8, mit einer Zuordnung, welches Kapitel
welchen Teil trägt: Core 5 (Service Layer), Core 3 (Filter-Syntax), Core 4
(Lebenszyklus), Compendium 104 (Configuration Admin), 105 (Metatype), 112
(Declarative Services) und 159 (Feature Service, noch ohne Gegenstück).

Damit ist eine Frage nach dem gemeinten Verhalten nachlesbar statt zu raten.

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