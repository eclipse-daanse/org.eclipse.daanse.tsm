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
| **Umgebungsneutral** | Kein Zugriff auf `window` oder `document` im Kern; der Loader läuft im Browser und in Node |
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

  /** Ein `policy: 'dynamic'`-Service ist erschienen, während das Modul läuft */
  onServiceBound?(context: ModuleContext, serviceId: string): Promise<void> | void

  /** Ein `policy: 'dynamic'`-Service ist verschwunden — das Modul läuft weiter */
  onServiceUnbound?(context: ModuleContext, serviceId: string): Promise<void> | void
}
```

#### Zwei Ebenen: Modul und Component

`requiresService` im Manifest parkt das **ganze Modul**, solange ein Service
fehlt. Was eine einzelne Component braucht, sagt sie selbst — mit `@inject()`:

```typescript
@component({ service: [MAP_VIEW] })
export class Map2D {
  constructor(@inject(TILE_SERVICE) private tiles: TileSource) {}
  @activate() start(): void { /* … */ }
}
```

Fehlt `demo.tiles`, wird diese Component **nicht registriert** — und das Modul
läuft weiter. Verschwindet der Service später, wird sie mit `@deactivate`
gestoppt und ihre eigenen Services abgemeldet; kommt er zurück, startet sie neu.
Das ist DS' Unterscheidung (112.5.2), und `getComponents()` benennt beide Gründe:

| Zustand | |
| --- | --- |
| `unsatisfied-reference` | ein injizierter Service fehlt; `waitingFor` nennt ihn |
| `unsatisfied-configuration` | eine verlangte PID fehlt (§11.3) |
| `satisfied` | registriert, noch nicht erzeugt (delayed) |
| `active` | eine Instanz existiert |

`@inject(id, { optional: true })` wartet nicht.

#### Dynamische Referenzen: `@bind` und `@unbind`

Eine `@inject()`-Referenz ist statisch: kommt oder geht der Service, wird die
Component neu gebaut. Wer stattdessen benachrichtigt werden will, benennt die
Methoden — und benennt sie, indem der Decorator auf ihnen steht:

```typescript
@component({ service: [MAP_VIEW] })
export class Map2D {
  private traffic?: TrafficService

  @bind(TRAFFIC_SERVICE, { optional: true })
  setTraffic(traffic: TrafficService, context: ComponentContext): void {
    this.traffic = traffic
  }

  @unbind(TRAFFIC_SERVICE)
  unsetTraffic(): void {
    this.traffic = undefined
  }

  @activate() start(): void { /* … */ }
}
```

| | |
| --- | --- |
| Reihenfolge | `@bind` läuft **vor** `@activate` und in Deklarationsreihenfolge, wie in DS (112.5.10 vor 112.5.11) — die Aktivierung soll sehen, was sie bekommen hat |
| Argumente | der Service selbst, dann der `ComponentContext` |
| mandatory (Default) | muss zum Start da sein; verschwindet er, läuft `@unbind` und die Component wird **gestoppt** — DS 112.5.18: kein Ersatz, keine Component |
| `{ optional: true }` | muss nicht da sein; verschwindet er, läuft nur `@unbind` und die Component **bleibt** |
| ohne `@unbind` | der Verlust wird nur protokolliert. Zu stoppen würde eine optionale Referenz in eine verpflichtende verwandeln, also entscheidet die Component |
| Fehler in der Methode | wird protokolliert, nicht geworfen — die Component bleibt, wie sie ist |

Eine Component mit `@bind` gilt als **immediate**, auch ohne `@activate`: ohne
Instanz könnte sie nichts erfahren.

#### Eine einzelne Component abschalten

```typescript
await loader.disableComponent('map', 'Map2D')
await loader.enableComponent('map', 'Map2D')
loader.getDisabledComponents()   // ['map/Map2D']
```

Wie bei `disableModule` eine eigene Dimension: die Component wartet nicht, sie ist
aus — und wird von keiner Reconciliation zurückgeholt. Ihre Services werden
abgemeldet, `@deactivate` läuft, und was davon abhing, reagiert wie auf jede andere
Abmeldung. Der Schalter überlebt einen `reloadModule()`, weil er zur Installation
gehört und nicht zur Instanz, und darf gesetzt werden, bevor das Modul überhaupt
geladen ist. In der Konsole: `tsm.disableComponent(id, class)`.

Innerhalb eines Moduls arbeitet der Loader in Runden, weil eine Component den
Service einer anderen brauchen kann und die Reihenfolge im Modul darüber nichts
sagt — derselbe Fixpunkt wie auf Modulebene. Aktiviert wird dann in der
Reihenfolge, in der registriert wurde: sonst würde ein Konsument starten, dessen
Anbieter erst konstruiert, aber noch nicht initialisiert ist.

**Wann welche Ebene?** `requiresService` ist das grobe Werkzeug: „ohne das hat das
ganze Modul keinen Sinn". Für alles andere ist die Component-Ebene die genauere
Antwort — ein Modul mit fünf Components verliert dann nur die eine.

#### Statisch oder dynamisch

`requiresService` sagt mit zwei getrennten Feldern, was ein Service für ein Modul
bedeutet — und die Trennung ist wichtig, weil sie oft verwechselt wird:

| | |
| --- | --- |
| `cardinality` | ob das Modul **starten** darf. `1..1` (Default) und `1..n` verlangen einen Provider, `0..1` und `0..n` nicht |
| `policy` | was ein **späterer Wegfall** tut. `static` (Default) baut das Modul ab, `dynamic` lässt es laufen und benachrichtigt es |

Auch ein `dynamic`-Requirement muss also zum Start erfüllt sein; wer einen Service
möchte, der nie existieren muss, schreibt `cardinality: '0..1'`.

```json
{ "requiresService": [{ "id": "demo.traffic", "policy": "dynamic", "cardinality": "0..n" }] }
```

```typescript
export function onServiceBound(context: ModuleContext, serviceId: string) {
  // Erneut sammeln — die Referenzen können sich geändert haben
  refresh(context.services.getServiceReferences('demo.traffic'))
}

export function onServiceUnbound(context: ModuleContext, serviceId: string) {
  // Referenz fallen lassen; das Modul wird nicht abgebaut
}
```

Eine Sammlung (`0..n` / `1..n`) hört von **jedem** Provider, der kommt oder geht,
weil das die Menge verändert. Ein einwertiges Requirement hört nur von
An- und Abwesenheit: dass ein zweiter Provider auf der Bank sitzt, ist nicht seine
Sache — und ein Wechsel zum besseren ist `policyOption: 'greedy'`.

Ein Fehler in einem der beiden Hooks bricht die Kaskade nicht ab und wird
protokolliert: das Modul bleibt aktiv, denn genau das verspricht `dynamic`.

**Abweichung von DS:** Dort ist die Policy eine Eigenschaft der *Referenz einer
Component* (112.3.7), und die bind/unbind-Methoden gehören der Component. Hier ist
sie eine Eigenschaft eines Requirements des **Moduls**, und die Hooks sind die des
Moduls. Component-Referenzen mit eigenen bind/unbind-Methoden fehlen — siehe die
Lückenliste in [`docs/CONFORMANCE.md`](docs/CONFORMANCE.md).

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
    // `container`: ein bereits importiertes Modul übergeben, statt `entry` zu holen
    options?: { awaitCascade?: boolean; container?: unknown }
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
  type: 'registered' | 'updated' | 'unregistered' | 'modified-endmatch'
  serviceId: string
  service: unknown
  /** Die aktuellen Properties des Service */
  properties?: Readonly<ServiceProperties>
}
```

`addListener(listener, { filter })` verengt, was ein Listener hört — und nur ein
filternder Listener bekommt `modified-endmatch`: die Properties haben sich so
geändert, dass der Service den Filter **nicht mehr** erfüllt (OSGi Core 5.6.1,
MODIFIED_ENDMATCH).

Genau dafür gehört das Filtern hierher und nicht in den Callback. Ein Listener,
der die Properties selbst prüft, erfährt nie, dass ein Service, den er
akzeptiert hatte, aufgehört hat zu passen — was er gesammelt hat, wird still
falsch.

```typescript
context.services.addListener(
  { onServiceEvent: event => {
      if (event.type === 'modified-endmatch') this.drop(event.serviceId)
    } },
  { filter: '(kind=chart)' }
)
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

### 6.2a Die Bundle-Grenze

ES-Module haben kein Gegenstück zum Klassenlader. Ein relativer Pfad in die
Quellen eines anderen Bundles kompiliert, bündelt und läuft — mit dessen Code
hineinkopiert, ohne Eintrag im Manifest, und das Service-Layer umgangen. Zur
Laufzeit kann das niemand erkennen, und die Kopie funktioniert weiter, nachdem
das andere Bundle abgezogen wurde.

Die Grenze liegt dort, wo das **Manifest** liegt: ein Bundle ist durch sein
Manifest definiert, also ist `dirname(manifest)` die Wurzel.

```typescript
tsmPlugin({
  manifest: resolve(__dirname, 'manifest.json'),
  boundary: { allow: ['../contracts.ts'] }
})
```

Immer erlaubt ist alles unter der Wurzel und alles unter `node_modules` — eine
npm-Abhängigkeit ist eine deklarierte Abhängigkeit. Alles andere bricht den Build,
mit der Datei und dem Importeur in der Meldung:

```
tsm: ../outline/src/index.ts is outside this bundle and its code was copied
into index.js — imported by src/index.ts.
```

**Immer ein Fehler**, anders als die übrigen Prüfungen des Plugins. Eine
undeklarierte Abhängigkeit kostet einen unnötigen Modul-Ladevorgang; eine Datei
über die Bundle-Grenze ist strukturell falsch — es gibt keine Variante davon, die
bloß unsauber wäre. Die Stelle, an der eine Ausnahme steht, ist `boundary.allow`,
wo sie aufgeschrieben ist statt geduldet.

Dort gehört das **Vertragsmodul** hin: es liegt mit Absicht außerhalb jedes
Bundles, und genau darum muss es benannt werden statt erraten. Was hier steht,
landet als Kopie im Bundle — die Liste sollte kurz bleiben, und jeder Eintrag
etwas ohne Verhalten sein.

Ohne Manifest-Pfad und ohne `root` bleibt die Prüfung aus: aus dem Entry oder dem
Arbeitsverzeichnis eine Grenze zu raten würde eine ziehen, die niemand erklärt
hat. `boundary: false` schaltet sie ab.

#### Das kleinere Loch: ein fehlendes `type`

Ein Import ohne `type` ist ein Wert-Import, und der Bundler folgt ihm — die Datei
wird geholt, mit allem, was *sie* importiert. Bei einem reinen `interface`
passiert heute nichts, aber ein Vertragsmodul wächst: ein Enum, eine Konstante,
eine Hilfsfunktion. Dann fängt dieselbe Zeile an, Code über die Bundle-Grenze zu
kopieren.

`verbatimModuleSyntax: true` macht den Unterschied bedeutsam,
`@typescript-eslint/consistent-type-imports` macht ihn sichtbar. Beim Einschalten
kamen elf Stellen zum Vorschein — alle in Tests, alle `ModuleLoader` als Wert
importiert, wo nur der Typ gebraucht wurde.

Der Fix-Stil ist dabei **nicht** kosmetisch:

```typescript
import { type Thing } from './dep.js'   // →  import {} from './dep.js'
import type { Thing } from './dep.js'   // →  (nichts)
```

Die Inline-Form lässt einen Side-Effect-Import zurück, dem der Bundler folgt —
also genau das, wovor die Grenzprüfung schützen soll. Nur die getrennte Form
verschwindet ganz. Deshalb steht `fixStyle: 'separate-type-imports'` in der
Lint-Konfiguration.

Bei einem *gemischten* Import bleibt alles wie es ist: das Modul wird für seinen
Wert ohnehin zur Laufzeit gebraucht, also kostet `import { ID, type Contract }`
nichts und hält den Vertrag auf einer Zeile.

Daraus folgt eine praktische Ersparnis: ein Bundle, das den Vertrag **nur als
Typ** importiert, braucht keinen `boundary.allow`-Eintrag dafür — es wird nichts
kopiert, also gibt es nichts zu erlauben. Nötig wird der Eintrag erst durch einen
Wert, etwa eine ID-Konstante.

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

### 9.1 Erledigt, teils unter anderem Namen

- [x] **Config-System**: Konfiguration pro Component über PIDs — Configuration Admin
      und Metatype (§11.3, §11.4)
- [x] **Extension Points**: das Whiteboard-Muster ist das formale System. Eine
      Extension ist ein Service mit Properties, ein Extension Point eine
      Collection-Referenz darauf (§11.4c) — mit Ranking, Target-Filtern und
      Auflösung vor dem Laden. Ein zweites Konstrukt daneben wäre eines zu viel.
- [x] **Error Boundaries**: eine Component, deren `@activate` wirft, wird
      verworfen; ihr Modul und ihre Geschwister laufen weiter (DS 112.5.8). Ein
      fehlerhaftes `@deactivate` hält die Abmeldung nicht auf, und ein werfender
      Listener nimmt die anderen nicht mit.
- [x] **DevTools**: als Konsolen-Kommandos statt als Browser-Extension —
      `tsm.help()`. Sie gehen über `tsm.component.runtime`, könnten also selbst
      ein Modul sein (§11.4g).
- [x] **Lazy Loading** *auf Component-Ebene*: eine delayed Component entsteht bei
      der ersten Auflösung, nicht beim Start ihres Moduls. Module lazy zu laden
      gibt es nicht — siehe unten.

### 9.2 Offen, mit Begründung

- [ ] **Permissions-System**: Module sollen deklarieren, welche APIs sie nutzen.
      Die Deklaration wäre heute leicht (`requirements` mit eigenem Namespace, wie
      Core 3.3 es vorsieht) — was fehlt, ist die Durchsetzung: im Browser gibt es
      keine Grenze zwischen Modulen, hinter der man etwas verweigern könnte.
      Deklaration ohne Durchsetzung ist Dokumentation, und die gibt es schon.
- [ ] **Sandbox-Isolation**: dieselbe Grenze, härter. Mit dem Wegfall von
      `window` und dem Übergang auf Import Maps hat sich die Frage verschoben:
      ein Modul in einem Worker oder Realm könnte isoliert laufen, aber die
      Service-Registry lebt von geteilten Objektreferenzen. Was über eine
      Realm-Grenze geht, ist serialisierbar — das wäre ein anderes Service-Modell,
      nicht eine Option an diesem.
- [ ] **Lazy Loading von Modulen**: `resolveWiring()` sagt schon vor dem Laden, was
      laufen könnte, also wäre „erst laden, wenn ein Service gebraucht wird"
      ausdrückbar. Offen ist, was den Bedarf auslöst: ein `get()` auf eine ID, die
      niemand registriert hat, kann nicht warten, ohne asynchron zu werden.
- [ ] **Preloading**: braucht Lazy Loading, um überhaupt einen Unterschied zu
      machen.
- [ ] **Metrics**: Zeit in `@activate`, Zahl der Auflösungen pro Service. Klein,
      und bisher hat es niemand gebraucht.

### 9.3 Bewusst nicht

- **A/B Testing über parallele Versionen**: zwei Versionen eines Moduls
  gleichzeitig setzen zwei Klassenräume voraus (Core 3.6). ES-Module geben keine
  Isolation, an der eine zweite Version hängen könnte. Zwei *Anbieter* eines
  Service mit unterschiedlichem Ranking und Target-Filtern lösen den praktischen
  Fall.
- **Automatisches Rollback bei Fehlern**: was ein fehlgeschlagener Start
  hinterlassen soll, weiß nur die Anwendung. Ein Feature (§11.4h) ist entweder
  installiert oder nicht — das ist die Stelle für Alles-oder-nichts, und dort ist
  es implementiert.

### 9.4 Bekannte Limitierungen

1. **SSR**: Der Loader selbst läuft in Node — Module werden über `container` /
   `entryResolver` übergeben oder per `file:`/`data:`-URL importiert. `http(s)`-URLs
   brauchen in Node `--experimental-network-imports`; die Runtime für geteilte
   Bibliotheken (`__tsm__`) bleibt browsergebunden
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

### 11.3a Module übergeben statt holen

Ein Modul kommt auf drei Wegen zum Loader, in dieser Reihenfolge:

```typescript
// 1. explizit, pro Aufruf — für Tests und einzelne Module
await loader.loadModule(manifest, { container: await import('./modules/tiles.js') })

// 2. über einen Resolver — für eine Anwendung, deren Module noch im Host-Bundle liegen
const preloaded = new Map([['tiles', tilesNamespace]])
new ModuleLoader({ entryResolver: manifest => preloaded.get(manifest.id) })

// 3. sonst: dynamischer Import von `manifest.entry`
```

**Es gibt keinen globalen Namensraum mehr.** Früher wurde ein Modul unter
`window[moduleId]` gesucht — die Module-Federation-Konvention. Das hatte drei
Kosten: Kollisionen mit DOM-`id`s, die der Browser als Globals auslegt (`<ul
id="palette">` wurde als Modul `palette` genommen); zwei Anwendungen auf einer
Seite teilten den Namensraum; und der Loader war in Node nicht lauffähig, weil
`window` dort nicht existiert.

Entfallen ist damit auch der halbe Module-Federation-Pfad: `container.get(export)`
wurde aufgerufen, `container.init(shareScope)` nie — für einen echten Remote also
untauglich, und §2 schließt Module Federation ohnehin aus dem Scope aus.

Ein übergebener Container wird für `reloadModule()` behalten: ein Modul ohne
abrufbare URL startet auf demselben Code neu. `unloadModule()` gibt ihn frei.

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

#### Das System Bundle

Nicht jede Capability kommt aus einem Modul, das jemand geschrieben hat: die
geteilten Bibliotheken registriert der Host (§6.2), und die Umgebung bringt
möglicherweise mehr mit. OSGi löst das, indem es der Umgebung die Gestalt eines
Moduls gibt — *„In addition to normal bundles, the Framework itself is
represented as a bundle"* (Core 4.6). Damit braucht der Resolver keinen
Sonderfall: er kennt Module mit Capabilities, und eines davon ist die Laufzeit.

tsm hat dasselbe:

```typescript
loader.getSystemBundle()
// { id: 'system.bundle', entry: 'System Bundle', capabilities: [ … ] }
```

Darauf hängen die registrierten Bibliotheken als `tsm.library`-Capabilities, und
was der Host sonst zusagt:

```typescript
new ModuleLoader({
  systemCapabilities: [
    { namespace: 'acme.screen', attributes: { width: 640, height: 480, card: 'GeForce' } }
  ]
})
```

Das ist die Entsprechung zu `org.osgi.framework.system.capabilities.extra` — das
Beispiel ist wörtlich das der Spezifikation. Ein Modul kann darauf ein Requirement
stellen wie auf jedes andere, und die Auflösung urteilt, bevor es geladen wird.

| | |
| --- | --- |
| `id` | `system.bundle`, was OSGi als Alias des implementierungseigenen Namens verlangt |
| `entry` | der feste String `System Bundle`, wie `getLocation()` dort zurückgibt |
| ladbar | nein — `loadModule()` weist es ab, so wie `start()` dort nichts tut |
| in `getManifests()` | nein: die Methode beantwortet, was registriert wurde, und das wurde es nicht |

`getWiring()` nimmt es von selbst hinzu, `tsm.capabilities()` zeigt es. Mit
`sharedLibraries: 'import-map'` fehlen die Bibliotheken darin, weil der Loader
nicht erfährt, welche die Map bereitstellt — dort prüft `generateImportMap()`.

Wer ohne System Bundle auflösen will, kann Capabilities direkt übergeben:
`resolveWiring(manifests, { offered })`, mit `environment` als Anbietername. Mit `sharedLibraries: 'import-map'` entfällt es: dort weiß der Loader
nichts über die verfügbaren Bibliotheken, und `generateImportMap()` ist die
Stelle, an der geprüft wird.

**Eine Bibliothek kann stattdessen auch ein Modul sein**, das die Capability
selbst deklariert:

```json
{
  "id": "vue-bundle",
  "capabilities": [
    { "namespace": "tsm.library", "attributes": { "library": "vue", "version": "3.5.13" } }
  ]
}
```

Dann schließt sich die Kette ohne Host-Sonderweg — so wie eine geteilte
Bibliothek in OSGi ein Bundle ist, das ein Package exportiert. Für den *Import*
ändert das nichts: `import { ref } from 'vue'` löst der Bundler oder der Browser
auf, nicht der Loader. Das Modul-Dasein betrifft die Deklaration und die
Auflösung, nicht den Transportweg.

`generateImportMap()` liest diese Capabilities: `offeredByModules(manifests)`
sammelt, was die Module selbst anbieten, und die `entry` des Moduls ist die URL —
bei einem **Library-Bundle** *ist* das Modul das Package. Damit deckt derselbe
Mechanismus „der Host liefert Vue" und „dieses Bundle liefert unsere Geometrie".
Der Konsument merkt keinen Unterschied, und das ist der Punkt:
`import { project } from 'geo'` sagt nichts darüber, wer liefert.

Bieten Host **und** Modul dieselbe Bibliothek an, gewinnt der Host — er ist die
äußere Umgebung, und ein Modul kann nicht wissen, was sonst noch gegen die Kopie
des Hosts gebaut wurde. Gemeldet wird es als `shadowed`, denn meist heißt es, dass
ein Library-Bundle ausgeliefert wurde, das niemand braucht.

So ein Bundle wird nie **aktiviert**: es hat keine Components und keine Services,
also gibt es nichts zu starten. Der Browser holt es über die Import Map, wenn
jemand es importiert — genau das Verhalten eines API-Bundles, das nie gestartet
wird.

#### Was fehlt, und warum

Package-Wiring (`Import-Package`/`Export-Package`) hat kein Gegenstück: ES-Module
lösen ihre Importe selbst auf. Damit entfallen auch `uses`-Constraints und
Klassenraum-Konsistenz (Core 3.7), Fragmente und Refresh — sie setzen einen
Klassenlader voraus. Die Provider-Auswahl (Core 3.7.10) ist auf „höchste Version
gewinnt" reduziert; ein vollständiger Constraint-Solver löst Probleme, die ohne
Package-Wiring nicht entstehen.

In der Konsole: `tsm.capabilities(ns?)`, `tsm.wiring(id)`, `tsm.unresolved()`.

### 11.4b Service-Scope: wer teilt sich eine Instanz

```typescript
type ServiceScope = 'singleton' | 'module' | 'transient'
```

- **`singleton`** (Standard): eine Instanz für das ganze System.
- **`module`**: eine Instanz **pro konsumierendem Modul**, erzeugt bei dessen
  erstem Zugriff und freigegeben, wenn das Modul deaktiviert wird — mit
  `dispose()`, falls die Instanz eine solche Methode hat. Das ist OSGi's
  `bundle`-Scope unter dem Namen, den tsm für ein Bundle verwendet.
- **`transient`**: eine neue Instanz bei jedem Zugriff.

`module` ist der Scope für einen Service, der Zustand **über** seinen Nutzer
führt: ein Cache pro Modul, eine Session, ein Undo-Stack. Ein Singleton würde den
Zustand zweier Module vermischen, `transient` würde ihn zwischen zwei Aufrufen
verlieren.

```typescript
@perModule()
@injectable()
export class UndoStack { private entries: Change[] = [] }
```

Zwei Dinge sind dabei wichtiger als der Scope selbst:

**Die eigenen Referenzen eines Service werden für das Modul aufgelöst, das ihn
_anbietet_ — nicht für das, das gefragt hat.** Wessen Code läuft, entscheidet,
wessen Instanz er bekommt. Sonst leckt der Scope die Abhängigkeitskette hinab, und
ein Singleton hätte für zwei Konsumenten zwei verschiedene Abhängigkeiten unter
sich.

**Ohne Konsumenten teilt der Scope eine Instanz.** Wer die Registry direkt
benutzt, außerhalb jedes Moduls, sieht Singleton-Verhalten — eine neue Instanz pro
Aufruf wäre `transient`, ein Vertrag, den die Registrierung nicht deklariert hat.

**Den Scope entscheidet der Anbieter, nicht der Konsument.** DS erlaubt einer
Referenz, einen Scope zu *verlangen* (`bundle`, `prototype`; 112.3.6) — hier gibt
es das nicht. Ob ein Service teilbar ist, weiß der, der ihn schreibt: ob er
Zustand führt, ob er teuer ist, ob zwei Nutzer sich gegenseitig stören. Ein
Konsument, der eine eigene Instanz verlangen kann, umgeht diese Aussage, ohne sie
widerlegen zu können.

### 11.4c Collection-Referenzen: alle Anbieter statt des besten

```typescript
@component()
export class Map2D {
  @injectAll(TILE_SOURCE, { fieldOption: 'update' })
  private sources: TileSource[] = []
}
```

Kardinalität 0..n auf einem Feld, aktuell gehalten, solange die Component läuft:
ein Anbieter, der kommt oder geht, ändert die Collection, ohne die Component neu
zu bauen. Ein leeres Feld blockiert nicht — 0..n ist erfüllt.

Die `fieldOption` (DS 112.3.9) entscheidet **wie**:

- **`replace`** (Standard): das Feld bekommt ein neues Array zugewiesen.
- **`update`**: das gehaltene Array wird an seiner Stelle geändert. Seine
  Identität bleibt — was eine reaktive View braucht, die daran gebunden ist. Mit
  `replace` sähe ein Template, das das alte Array hält, die Änderung nie.

`update` verlangt dafür, dass das Feld initialisiert ist (`= []`); sonst gibt es
nichts zu ändern, und der Loader meldet es und weist zu. Hat sich nichts geändert,
passiert nichts — eine unnötige Zuweisung würde eine reaktive View bei jedem
fremden Registry-Ereignis neu rendern lassen.

### 11.4d Conditions: auf eine Aussage warten

Eine Condition ist ein Service ohne Verhalten — nur die Aussage, dass etwas der
Fall ist. Der Weg, „nicht vorher" zu sagen, ohne einen Service zu erfinden, von
dem man abhängt, und ohne dass der Wartende weiß, wer entscheidet.

```typescript
@component({ satisfyingCondition: conditionFilter('data.loaded') })
export class Report { @activate() start() { /* ... */ } }

// woanders, wenn es soweit ist:
context.services.register(CONDITION_SERVICE_ID, TRUE_CONDITION, {
  properties: conditionProperties('data.loaded')
})
```

Behandelt wie eine weitere verpflichtende Referenz — so modelliert DS es auch
(112.3.13). Solange nichts passt, wartet die Component; ihr Modul läuft weiter.
`condition.id=true` ist immer registriert, damit ein Filter eine Grundlinie hat,
gegen die er geschrieben werden kann.

### 11.4e Factory-Components: eine Instanz auf Zuruf

```typescript
@component({ factory: 'editor', service: ['editor.instance'] })
export class Editor {
  @activate() start(context: ComponentContext) { this.open(context.configuration.file) }
}

// beim Aufrufer:
const factory = services.getMatching<ComponentFactory>(
  COMPONENT_FACTORY_SERVICE_ID, componentFactoryFilter('editor')
)
const tab = await factory.newInstance({ file: 'a.ts' })
await tab.dispose()
```

Statt der eigenen Services registriert die Component eine `ComponentFactory`
(DS 112.2.4); jedes `newInstance()` baut eine Instanz mit den Properties des
Aufrufers. Nicht zu verwechseln mit einer Factory-**Konfiguration**: der
Unterschied ist, wer entscheidet, dass es eine weitere geben soll. Eine
Factory-Konfiguration ist Daten — ein UI oder eine Datei erzeugt Instanzen. Eine
Factory-Component ist ein Aufruf — Code erzeugt sie. „Ein Editor pro offenem Tab"
kann nur der Code wissen, der Tabs öffnet.

Die Instanzen sind gewöhnliche Component-Instanzen: `@activate` läuft, die
Services werden mit den übergebenen Properties registriert, also sind sie für
jeden auffindbar, der darauf filtert — nicht nur für den Aufrufer. `dispose()`
beendet eine; nichts anderes tut es, denn eine Instanz, die niemand konfiguriert
hat, wird nicht dadurch zurückgeholt, dass Konfiguration verschwindet.

Die Factory folgt der Satisfaction: fehlt eine verpflichtende Referenz, wird sie
abgemeldet — niemand soll eine Instanz von etwas anfordern können, das nicht
laufen kann. Kommt die Referenz zurück, kommt die Factory zurück, die früheren
Instanzen aber nicht: sie gehörten dem, der sie angefordert hat.

### 11.4f Targeted PIDs: eine Konfiguration für eine Version

`pid|modulId|version` konfiguriert eine PID nur für dieses Modul, oder nur für
diese Version davon (CM 104.3.2). Gesucht wird vom Spezifischsten zum
Allgemeinsten, die erste Konfiguration **mit Werten** gewinnt:

```
demo.tiles|map-plugin|2.1.0   →   demo.tiles|map-plugin   →   demo.tiles
```

Was es bringt, ist ein Rollout: die neue Version bekommt ihre eigene
Konfiguration, während die alte auf der untargeted weiterläuft. `location` aus
OSGi entfällt — ein Modul hat keinen Installationsort.

Ein Eintrag ohne Werte beendet die Suche nicht: `getConfiguration()` erzeugt
solche, und einer davon darf keine Konfiguration verdecken, die Werte hat.

### 11.4g Die Component-Ebene als Service

In OSGi ist SCR ein gewöhnliches Bundle: ein Extender, der die
Component-Beschreibungen *anderer* Bundles liest und sie von außen verwaltet. Das
Framework selbst kennt Declarative Services überhaupt nicht. Zwei Dinge folgen
daraus, die tsm übernimmt, obwohl der Extender hier kein eigenes Bundle ist.

**Introspektion ist ein Service.** Der Loader veröffentlicht
`ServiceComponentRuntime` unter `tsm.component.runtime` (DS 112.10):

```typescript
@component()
export class ComponentView {
  constructor(
    @inject(COMPONENT_RUNTIME_SERVICE_ID) private readonly scr: ServiceComponentRuntime
  ) {}

  @activate()
  start() {
    for (const declaration of this.scr.getComponentDescriptions()) {
      // Zustand, Referenzen, wartende Konfigurationen
    }
  }
}
```

Das ist der Unterschied zwischen einem Werkzeug, das als Modul ausgeliefert werden
kann, und einem, das im Host leben muss. Vorher war `loader.getComponents()` der
einzige Weg, und der `ModuleContext` gibt den Loader nicht weiter — eine
Component-Ansicht, ein Diagnose-Panel oder Devtools waren damit Host-Sache. Die
Devtools in diesem Paket gehen jetzt über den Service, genau wie `scr:list` in
OSGi ein Shell-Bundle ist, das mit SCR redet.

**Was die Laufzeit bietet, kann ein Modul anfordern.** Das System Bundle trägt die
Capabilities, die in OSGi vom jeweiligen Implementierungs-Bundle kommen:

| Capability | wann |
|---|---|
| `osgi.extender=osgi.component` | immer — die Component-Ebene ist Teil des Loaders |
| `osgi.extender=osgi.metatype` | nur mit übergebener `MetatypeRegistry` |
| `osgi.implementation=osgi.cm` | nur mit übergebenem `ConfigurationAdmin` |

Die letzten zwei sind bedingt, und das ist der Punkt: eine Capability, auf die
sich niemand verlassen kann, ist schlimmer als keine. Ein Modul mit
`configurationSchema` würde sonst auflösen und dann feststellen, dass sein Schema
verworfen wird.

```json
{
  "id": "config-forms",
  "requirements": [
    { "namespace": "osgi.extender", "filter": "(osgi.extender=osgi.metatype)" }
  ]
}
```

Was tsm **nicht** hat: SCR ist nicht stoppbar und nicht austauschbar, weil der
Loader beides in einem Objekt ist. „Alle Components anhalten, Bundles laufen
lassen" gibt es nur einzeln über `disableComponent()`. Das ist die
Modell-Abweichung, die in `docs/CONFORMANCE.md` bei 112.9 steht — und alles, was
davon übrig ist.

### 11.4h Features: Module, Konfiguration und Version als ein Dokument

Ab einer bestimmten Zahl von Modulen passt die Liste „was laden, in welcher
Version, mit welcher Konfiguration" nicht mehr in einen Kopf und lebt im
Host-Code — wo sie nicht versioniert, nicht reviewt und nicht ausgeliefert werden
kann. Ein **Feature** (OSGi Compendium 159) ist genau dieses Dokument:

```json
{
  "feature-resource-version": "1.0",
  "id": "@acme/workbench@1.4.0",
  "name": "Die Werkbank",
  "complete": true,
  "bundles": [
    { "id": "tiles@1.0.0" },
    { "id": "map@2.1.0", "org.acme.docs": "https://docs/map" }
  ],
  "variables": { "tileUrl": "https://tiles/{z}/{x}/{y}", "apiKey": null },
  "configurations": {
    "demo.tiles": { "url": "${tileUrl}", "zoom:Integer": "3" },
    "demo.api": { "key": "${apiKey}" }
  }
}
```

Kommentare sind erlaubt (`//` und `/* */`, JSMin-Stil), und `stripComments()`
lässt Zeichenketteninhalte in Ruhe — eine URL mit `//` würde sonst stumm
abgeschnitten.

**Variablen** sind späte Bindung. Ein Default kann `null` sein: dann *muss* der
Launcher einen Wert liefern, was der Weg ist, ein Passwort zu deklarieren, ohne es
zu hinterlegen. Ein `${name}`, das niemand kennt, bleibt stehen — die Spezifikation
verlangt das, denn ein späterer Launcher könnte es kennen, und Leeren würde einen
fehlenden Wert in einen falschen verwandeln. Die Typsyntax `"zoom:Integer"` gibt es,
weil ein Platzhalter immer eine Zeichenkette liefert.

**Extensions** tragen fremden Inhalt mit: Text, JSON oder Artefakt-Listen, jeweils
`mandatory`, `optional` (Standard) oder `transient`. Eine verpflichtende Extension,
die der Installierende nicht kennt, lässt die Installation scheitern — sonst wäre
sie nicht verpflichtend.

**Installieren** lässt die Spezifikation offen; das ist Sache eines „Launchers".
`installFeature()` ist einer:

```typescript
await installFeature(readFeature(document), {
  loader,
  configurationAdmin,
  resolve: id => repository.manifestFor(id.name, id.version),
  variables: { apiKey: process.env.API_KEY }
})
```

Zwei Entscheidungen darin sind erwähnenswert:

**Konfiguration vor dem Laden.** Eine Component mit
`configurationPolicy: 'require'` läuft ohne ihre Konfiguration nicht, und eine mit
`@modified` würde direkt nach dem Start neu konfiguriert. Erst schreiben heißt:
jede Component sieht ihre Werte bei der ersten Aktivierung.

**Alles oder nichts.** Fehlt eine Variable, ein Modul oder ein Handler für eine
verpflichtende Extension, bricht die Installation ab, *bevor* etwas passiert. Ein
halb installiertes Feature ist schlimmer als keins, weil die Hälfte, die läuft,
nicht von einem System zu unterscheiden ist, das so gemeint war.

**Vollständigkeit** ist eine Behauptung des Autors (`complete: true`), keine
Tatsache. `isComplete(feature, { loader, manifests })` prüft sie gegen die echte
Auflösung — und rechnet mit, was die Laufzeit selbst anbietet. Dasselbe Feature ist
in einer Umgebung mit der nötigen Capability vollständig und in einer anderen
nicht, und genau diese Unterscheidung ist die berichtenswerte.

Was tsm anders macht: die Kennung ist `name@version` bzw. `@scope/name@version`
statt Maven-Koordinaten. tsm-Module sind npm-Pakete; eine `groupId` wäre ein Feld,
das niemand wahrheitsgemäß füllen könnte. Und `configurations` folgt direkt dem
Configuration Admin statt dem Configurator (Compendium 150), den tsm nicht hat.

Der Build-Scan liest eine Service-ID auch dann, wenn sie in einem **anderen
Paket** deklariert ist — dem API-Bundle, wo ein Vertrag hingehört — und auch dann,
wenn sie als `serviceId<T>('…')` statt als nacktes Literal geschrieben ist. Beides
zusammen ist nötig, damit `@component({ service: [WIDGET_SERVICE] })` das Manifest
füllt; jedes allein reicht nicht.

`node_modules` wird dabei von Hand durchlaufen statt über einen Resolver: der Scan
ist synchron, der Resolver des Bundlers ist es nicht, und `import.meta.resolve`
existiert unter Vite nicht. Die `types`-Bedingung wird zuerst probiert, weil ein
API-Paket im Workspace meist direkt auf die TypeScript-Quelle zeigt — und weil
gebaute Ausgabe nichts hilft, solange sie nicht gebaut ist. Landet die Auflösung
in einem Build-Verzeichnis, wird die passende Quelle mitprobiert.

In der Konsole: `tsm.feature(json)` liest ein Dokument und sagt, was eine
Installation noch bräuchte — ohne zu installieren, denn wo Module herkommen, ist
keine Entscheidung für eine Konsolenzeile.

### 11.4i Typisierte Service-IDs

In OSGi benennt das Interface den Service: `@Reference private TileService tiles;`
— die Deklaration *ist* der Vertrag. Ein TypeScript-Interface überlebt das
Kompilieren nicht, also benennt tsm Services mit Zeichenketten. Der Konsument
importierte damit zwei Dinge, wo eins genügen sollte, und niemand prüfte, ob sie
zusammengehören.

`serviceId()` schließt das. Der Vertrag nennt sich einmal, in beiden Namensräumen:

```typescript
// contracts.ts — die Zeichenkette steht genau hier, einmal
export interface TileService { tileUrl(z: number): string }
export const TileService = serviceId<TileService>('demo.tiles')
```

```typescript
// der Konsument: ein Import, ein Name
import { TileService } from './contracts.js'

@component({ service: [TileService] })
export class Raster implements TileService {
  constructor(@inject(TileService) private tiles: TileService) {}
}
```

Dass beide Namen gleich heißen dürfen, liegt daran, dass TypeScript Werte und
Typen in getrennten Namensräumen führt — derselbe Griff, mit dem `Date` und
`Array` in der Standardbibliothek arbeiten.

**Zur Laufzeit ist es die Zeichenkette.** `serviceId()` ist eine
Identitätsfunktion; `TileService === 'demo.tiles'` ist wahr. Damit bleiben
Manifest, Target-Filter, `osgi.service`-Capability und die Auflösung vor dem Laden
unberührt — und ein Modul, das den Token nie gesehen hat, findet den Service unter
seinem Namen.

**Rückwärtskompatibel.** Der Brand ist optional, also ist jedes String-Literal
weiterhin zuweisbar. Ein Vertrag kann Stück für Stück umgestellt werden.

Zwei Details, die beim Bauen entschieden wurden:

Die Signaturen nehmen `ServiceId<T>` **allein**, nicht `ServiceId<T> | string`.
Die Union sieht großzügiger aus, ist aber strikt schlechter: die Inferenz matcht
gegen `string`, lässt `T` unbestimmt, und jeder Aufruf kommt als `unknown` zurück
— sie akzeptiert dieselben Argumente und zerstört dabei das Einzige, wofür der
Typ da ist.

`register`, `bind` und `bindClass` nehmen den Wert als `NoInfer<T>`. Sonst hat der
Aufruf zwei Inferenzpositionen, das Argument gewinnt gegen den Token, und ein
falsch registrierter Service fällt nicht auf. So entscheidet die ID, was der
Vertrag ist, und der Wert muss sich fügen.

Dazu `getServices(id, target?)`: alle Anbieter einer ID, typisiert, ohne den
Vertrag bei jedem `resolveReference` erneut zu nennen. Ein Anbieter, der sich
nicht bauen lässt, fällt heraus statt als `undefined` in der Liste zu stehen.

**Was das nicht leistet:** die ID kanonisch machen. `serviceId<Widget>('demo.tiles')`
ist eine Lüge, die kein Compiler fängt, während ein Java-Klassenname nicht lügen
kann. Der Vertrag ist eine Datei, die einmal geschrieben und danach nur importiert
wird — dort muss die Ehrlichkeit herkommen.

### 11.4j Der Modul-Kontext als Service

`@activate(context)` gibt einer Component ihren Kontext — das ist das nähere
Gegenstück zu DS 112.5.8 und unverändert der Normalfall. Was es nicht erreicht:
eine Klasse, deren Abhängigkeit von der Registry **konstruktioneller** Art ist.

```typescript
@component({ service: [DatasourceRepository] })
export class Datasources implements DatasourceRepository {
  constructor(@inject(MODULE_CONTEXT_SERVICE_ID) private readonly context: ModuleContext) {}

  // zur Aufrufzeit, nicht zur Startzeit — darum braucht es der Konstruktor
  resolve<T>(id: ServiceId<T>): T { return this.context.services.getRequired(id) }
}
```

Ein Repository, das Bezeichner erst beim Aufruf auflöst, muss die Registry
*halten*. Ohne diesen Service musste so eine Klasse im `activate` des Moduls von
Hand gebaut und registriert werden — die imperative Form genau dessen, was
`@component` deklarieren soll.

Dass eine Service-ID pro Modul verschieden antwortet, leistet der
`module`-Scope: die Factory erfährt, für wen sie baut.

```typescript
services.bind(id, consumer => buildFor(consumer), { scope: 'module' })
```

Das ist auch die Grenze dessen, was hier möglich ist: der Kontext des **Moduls**,
nicht der der Component. Konfiguration und Service-Properties unterscheiden sich
pro Instanz, und zur Konstruktionszeit existiert die Instanz noch nicht — die
gehören in `@activate`, und dort sind sie.

Von außerhalb eines Moduls aufgelöst, wirft der Service statt zu antworten:
den Kontext eines fremden Moduls herauszugeben würde einen Teardown die falschen
Registrierungen freigeben lassen. Und eine Registry, die keine Factories kennt,
lässt ihn einfach fehlen — eine zulässige Minimalimplementierung soll den Loader
nicht mitnehmen.

### 11.5 Konformität

[`docs/CONFORMANCE.md`](docs/CONFORMANCE.md) stellt Abschnitt für Abschnitt
gegenüber, was tsm von OSGi Release 8 umsetzt und wo es abweicht — mit der Art der
Abweichung: **Sprache** (folgt aus TypeScript statt Java), **Plattform** (Browser
statt JVM), **Laufzeit** (asynchrones Modul-Laden), **Modell** (der Loader ist Framework
und SCR in einem), **Absicht** oder **Lücke**.

Von 142 verglichenen Punkten sind 73 konform, 49 anders und 20 nicht vorhanden.
Jede der 69 Abweichungen trägt einen Grund, und die meisten sind keine Wahl: 25
folgen aus der Sprache, 18 aus der Plattform, 2 aus dem Laufzeitmodell, 9 aus dem
Modulschnitt, 15 sind begründete Entscheidungen — und **keine ist mehr eine
Lücke**.

Was fehlt, fehlt aus einem Grund. Das ist eine andere Aussage als „noch nicht
gemacht", und die, für die diese Tabelle existiert.

### 11.6 Die Spezifikationen zum Nachlesen

Die Kapitel, auf die sich tsm bezieht, liegen unter
[`docs/osgi/`](docs/osgi/) — OSGi Release 8, mit einer Zuordnung, welches Kapitel
welchen Teil trägt: Core 5 (Service Layer), Core 3 (Filter-Syntax), Core 4
(Lebenszyklus), Compendium 104 (Configuration Admin), 105 (Metatype), 112
(Declarative Services) und 159 (Feature Service). Core 3.3
(Requirements und Capabilities) ist umgesetzt, siehe §11.4a.

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

### OSGi-Konformität (laufend)
Die sieben als Lücke geführten Punkte sind umgesetzt; `docs/CONFORMANCE.md` führt
keine Lücke mehr. Was fehlt, fehlt aus einem Grund — Sprache, Plattform, Modell
oder Absicht.
- **Configuration Admin** (104) und **Metatype** (105), Config pro Component
  (§11.3, §11.4)
- **Requirements und Capabilities** (Core 3.3) samt System Bundle (§11.4a)
- **Declarative Services** (112): Satisfaction pro Component, `@bind`/`@unbind`,
  enable/disable, Factory-Components (§11.4e), Collection-Referenzen mit
  `fieldOption` (§11.4c), Satisfying Conditions (§11.4d)
- **Service-Scope `module`** — OSGi's `bundle`-Scope (§11.4b)
- **`modified-endmatch`** für filternde Listener (§5.3)
- **Targeted PIDs** (§11.4f)

Begrifflich offen bleibt nur Compendium 159 (Feature Service).