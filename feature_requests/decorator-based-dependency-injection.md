# Feature Request: Decorator-basierte Constructor Injection in TSM ServiceRegistry

## Problem

Die TSM `ServiceRegistry` ist aktuell ein **Service Locator** — Services werden manuell erzeugt und verdrahtet. Bei tieferen Dependency-Graphen (z.B. ActionManager → RemoteExecutor → HttpClient → AuthManager) führt das zu viel Boilerplate und fehleranfälliger manueller Verdrahtung:

```typescript
// Heute: Manuelles Wiring in activate()
export async function activate(context: ModuleContext) {
  const credentials = context.services.getRequired<CredentialStore>('credential.store')
  const httpClient = new HttpClient()
  const authManager = new AuthManager(credentials)
  const executor = new RemoteActionExecutor(httpClient, authManager)
  const registry = new ActionRegistryImpl()
  const oclEvaluator = context.services.getRequired<OclEvaluator>('problems.ocl')
  const manager = new ActionManager(registry, executor, oclEvaluator)

  context.services.register('action.manager', manager)
}
```

Probleme:
- **Reihenfolge-Abhängig**: Der Entwickler muss den Dependency-Graph im Kopf haben
- **Redundant**: Die Klassen wissen eigentlich selbst, was sie brauchen
- **Fehleranfällig**: Falscher Parameter an falscher Stelle → Runtime-Fehler
- **Nicht lazy**: Alles wird sofort instantiiert, auch wenn es nie gebraucht wird

## Vorgeschlagene Lösung

### Decorator-basierte Constructor Injection

Services deklarieren ihre Abhängigkeiten direkt am Constructor via `@inject()` Decorator. TSM löst den Dependency-Graph automatisch auf.

### API-Design

#### Decorators

```typescript
import { injectable, inject } from 'tsm'

@injectable()
class HttpClient {
  // Keine Dependencies
}

@injectable()
class AuthManager {
  constructor(
    @inject('credential.store') private credentials: CredentialStore
  ) {}
}

@injectable()
class RemoteActionExecutor {
  constructor(
    @inject('http.client') private http: HttpClient,
    @inject('auth.manager') private auth: AuthManager
  ) {}
}

@injectable()
class ActionManager {
  constructor(
    @inject('action.registry') private registry: ActionRegistry,
    @inject('action.remote-executor') private remoteExecutor: RemoteActionExecutor,
    @inject('problems.ocl') private oclEvaluator: OclEvaluator
  ) {}

  async execute(actionId: string): Promise<ActionResult> {
    // alle Deps sind verfügbar
  }
}
```

#### Registrierung

```typescript
// Neue Methode: bindClass()
export async function activate(context: ModuleContext) {
  const { services } = context

  services.bindClass('http.client', HttpClient)
  services.bindClass('auth.manager', AuthManager)
  services.bindClass('action.registry', ActionRegistryImpl)
  services.bindClass('action.remote-executor', RemoteActionExecutor)
  services.bindClass('action.manager', ActionManager)
}
```

#### Auflösung

```typescript
// In einem anderen Modul — gesamter Graph wird lazy aufgelöst
const manager = services.getRequired<ActionManager>('action.manager')
// → löst automatisch auf: ActionRegistry, RemoteExecutor → HttpClient + AuthManager, OclEvaluator
```

### Optionaler inject

```typescript
@injectable()
class DataExporter {
  constructor(
    @inject('http.client') private http: HttpClient,
    @inject('logger', { optional: true }) private logger?: Logger
  ) {}
}
```

## Technische Umsetzung

### Voraussetzungen

**tsconfig.json** — Decorator-Support aktivieren:
```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

**package.json** — Neue Dependency:
```json
{
  "dependencies": {
    "reflect-metadata": "^0.2.2"
  }
}
```

### Neue Datei: `src/decorators.ts`

```typescript
import 'reflect-metadata'

const INJECTABLE_KEY = Symbol('tsm:injectable')
const INJECT_KEY = Symbol('tsm:inject')

interface InjectMetadata {
  index: number
  serviceId: string
  optional: boolean
}

/**
 * Markiert eine Klasse als injectable — Voraussetzung für Constructor Injection.
 */
export function injectable(): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(INJECTABLE_KEY, true, target)
  }
}

/**
 * Markiert einen Constructor-Parameter zur Injection.
 * @param serviceId - Service-ID in der ServiceRegistry
 * @param options - { optional: true } wenn der Service fehlen darf
 */
export function inject(serviceId: string, options?: { optional?: boolean }): ParameterDecorator {
  return (target, _propertyKey, parameterIndex) => {
    const existing: InjectMetadata[] = Reflect.getOwnMetadata(INJECT_KEY, target) ?? []
    existing.push({
      index: parameterIndex,
      serviceId,
      optional: options?.optional ?? false
    })
    Reflect.defineMetadata(INJECT_KEY, existing, target)
  }
}

/**
 * Liest die Inject-Metadaten einer Klasse aus.
 */
export function getInjectMetadata(target: Function): InjectMetadata[] {
  const metadata: InjectMetadata[] = Reflect.getOwnMetadata(INJECT_KEY, target) ?? []
  return metadata.sort((a, b) => a.index - b.index)
}

/**
 * Prüft ob eine Klasse als @injectable() markiert ist.
 */
export function isInjectable(target: Function): boolean {
  return Reflect.getOwnMetadata(INJECTABLE_KEY, target) === true
}
```

### Änderungen an `types.ts`

```typescript
// Neuer Typ
interface InjectableConstructor<T = unknown> {
  new (...args: any[]): T
}

// ServiceRegistry Interface erweitern
interface ServiceRegistry {
  // ... bestehende Methoden ...

  /**
   * Bindet eine Klasse mit automatischer Constructor Injection.
   * Die Klasse muss @injectable() sein und Dependencies via @inject() deklarieren.
   */
  bindClass<T>(
    id: string,
    ctor: InjectableConstructor<T>,
    options?: { scope?: 'singleton' | 'transient'; providedBy?: string }
  ): void
}
```

### Änderungen an `ServiceRegistry.ts`

```typescript
import { getInjectMetadata, isInjectable } from './decorators'

// ServiceBinding erweitern
interface ServiceBinding {
  factory?: (...args: unknown[]) => unknown
  instance?: unknown
  scope: 'singleton' | 'transient'
  providedBy?: string
  deps?: Array<{ serviceId: string; optional: boolean }>  // NEU
}

// Neue Methode in DefaultServiceRegistry
bindClass<T>(
  id: string,
  ctor: InjectableConstructor<T>,
  options: { scope?: 'singleton' | 'transient'; providedBy?: string } = {}
): void {
  if (!isInjectable(ctor)) {
    throw new Error(
      `Class '${ctor.name}' is not decorated with @injectable(). ` +
      `Add @injectable() to use bindClass().`
    )
  }

  const metadata = getInjectMetadata(ctor)

  this.bindings.set(id, {
    factory: (...resolvedDeps: unknown[]) => new ctor(...resolvedDeps),
    scope: options.scope ?? 'singleton',
    providedBy: options.providedBy,
    deps: metadata.map(m => ({ serviceId: m.serviceId, optional: m.optional }))
  })

  this.notify({ type: 'registered', serviceId: id, service: undefined })
}

// get() erweitern um automatische Dependency-Auflösung
get<T>(id: string, _resolving?: Set<string>): T | undefined {
  if (this.services.has(id)) {
    return this.services.get(id) as T
  }

  const binding = this.bindings.get(id)
  if (!binding) return undefined

  if (binding.scope === 'singleton' && binding.instance !== undefined) {
    return binding.instance as T
  }

  if (binding.factory) {
    const resolving = _resolving ?? new Set<string>()

    // Zirkuläre Abhängigkeit erkennen
    if (resolving.has(id)) {
      const chain = [...resolving, id].join(' → ')
      throw new Error(`Circular dependency detected: ${chain}`)
    }
    resolving.add(id)

    // Dependencies auflösen
    const args = (binding.deps ?? []).map(dep => {
      const resolved = this.get(dep.serviceId, resolving)
      if (resolved === undefined && !dep.optional) {
        throw new Error(
          `Dependency '${dep.serviceId}' not found (required by '${id}')`
        )
      }
      return resolved
    })

    const instance = binding.factory(...args) as T

    if (binding.scope === 'singleton') {
      binding.instance = instance
      this.services.set(id, instance)
    }

    return instance
  }

  return undefined
}
```

## Abwärtskompatibilität

| Bestehende API | Verhalten |
|---|---|
| `register(id, instance)` | Unverändert — direkte Instanz-Registrierung |
| `bind(id, factory)` | Unverändert — Factory ohne automatische Injection |
| `bind(id, factory, { deps })` | Neu, optional — Factory mit deklarativen Deps |
| `bindClass(id, ctor)` | Neu — Decorator-basierte Constructor Injection |
| `get(id)` | Erweitert — löst deps automatisch auf wenn vorhanden |
| `getRequired(id)` | Unverändert — nutzt erweitertes `get()` |

Bestehender Code funktioniert ohne Änderung weiter. Module können schrittweise migrieren.

## Beispiel: Gene Action-System

```typescript
// ── Service-Definitionen ─────────────────────────

@injectable()
class ActionRegistryImpl implements ActionRegistry {
  private actions = new Map<string, AbstractAction>()
  private byClass = new Map<string, Set<string>>()

  register(action: AbstractAction): void { /* ... */ }
  getActionsForClass(className: string): AbstractAction[] { /* ... */ }
}

@injectable()
class RemoteActionExecutor {
  constructor(
    @inject('http.client') private http: HttpClient,
    @inject('auth.manager') private auth: AuthManager
  ) {}

  async execute(action: RemoteAction, input: CollectedInput): Promise<ActionResult> {
    const headers = await this.auth.getHeaders(action.authConfig)
    return this.http.request(action.endpointUrl, { headers, body: input })
  }
}

@injectable()
class ActionManager {
  constructor(
    @inject('action.registry') private registry: ActionRegistry,
    @inject('action.remote-executor') private remote: RemoteActionExecutor,
    @inject('action.internal-executor') private internal: InternalActionExecutor,
    @inject('action.input-collector') private inputCollector: InputCollector,
    @inject('action.result-router') private resultRouter: ActionResultRouter
  ) {}

  async execute(actionId: string, context: ActionContext): Promise<ActionResult> {
    const action = this.registry.getAction(actionId)
    const input = await this.inputCollector.collect(action.inputSpec, context)
    const result = isRemoteAction(action)
      ? await this.remote.execute(action, input)
      : await this.internal.execute(action, input)
    await this.resultRouter.handle(result)
    return result
  }
}

// ── Registrierung ────────────────────────────────

// packages/action/src/index.ts
export async function activate(context: ModuleContext) {
  const { services } = context
  services.bindClass('action.registry', ActionRegistryImpl)
  services.bindClass('action.input-collector', InputCollector)
  services.bindClass('action.result-router', ActionResultRouter)
  services.bindClass('action.remote-executor', RemoteActionExecutor)
  services.bindClass('action.internal-executor', InternalActionExecutor)
  services.bindClass('action.manager', ActionManager)
}

// packages/plugins/metamodeler/src/index.ts
export async function activate(context: ModuleContext) {
  const registry = context.services.getRequired<ActionRegistry>('action.registry')
  registry.register({
    id: 'metamodeler.generate-docs',
    name: 'Dokumentation generieren',
    targetClassNames: ['EClass', 'EPackage'],
    perspectiveIds: ['metamodeler'],
    actionType: ActionType.DOCUMENTATION
  })
}
```

## Offene Fragen

1. **`reflect-metadata` als Dependency** — Soll es eine feste Dependency von TSM werden oder optional bleiben (nur nötig wenn `bindClass` genutzt wird)?
2. **Scope-Decorator** — Soll es zusätzlich `@singleton()` und `@transient()` Decorators geben, statt den Scope bei `bindClass()` anzugeben?
3. **Interface-Binding** — Soll es ein Pattern geben um Interfaces an Implementierungen zu binden (z.B. `services.bindClass('action.registry', ActionRegistryImpl, { implements: 'ActionRegistry' })`)?