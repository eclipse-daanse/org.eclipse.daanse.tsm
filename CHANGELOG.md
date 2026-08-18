# Changelog

All notable changes to the `@eclipse-daanse/tsm` package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Implements [#18](https://github.com/eclipse-daanse/org.eclipse.daanse.tms/issues/18) for the `static` case:
a module with an unmet `requiresService` waits instead of failing, and is torn down and rebuilt when a service
it requires disappears and returns. Load order follows from the manifests, so a hand-ordered startup list is
no longer needed. `policy: 'dynamic'` (staying active and being notified) is not implemented.

### Fixed

- **Circular module `dependencies` crashed the loader.** `ensureDependencies()` called `loadModule()`, which
  restarted a module that was already being loaded, so two modules depending on each other recursed until
  `RangeError: Maximum call stack size exceeded`. The resolver detected the cycle and warned, but loading ran
  into it anyway. `loadModule()` now returns the existing entry for a module in flight, and the modules end up
  parked on each other — visible in `getUnsatisfiedModules()` instead of a stack overflow.
- **A dependent could activate after its dependency was unloaded.** Satisfaction only counted a dependency
  that was present but not active, so once the dependency was removed from the loader it stopped counting at
  all and the dependent looked satisfied. Any dependency that is not active now blocks activation, whether it
  is parked, still loading, failed, or gone.
- `unloadModule()` and `reloadModule()` await the resulting cascade, so callers see a settled state rather
  than a half-processed queue.
- **`unregister()` left alias bindings behind.** `bindClass(id, ctor, { implements: [...] })` creates alias
  bindings that delegate to the primary ID, but unregistering the primary removed only its own entry. The
  aliases survived as dangling entries, where `has(alias)` reported the service while `get(alias)` returned
  `undefined` — so `checkRequirements()`, which goes through `has()`, considered a requirement satisfied for
  an unreachable service and a module activated only to fail on first use. Aliases are now tracked in a
  reverse index and removed with their primary, each with its own `unregistered` event. `has()` additionally
  resolves alias chains, so an orphaned alias reads as absent however it came about.
- **`clear()` skipped lazily bound services.** It iterated the instantiated services only, so anything
  registered via `bind()` and never resolved stayed in the registry; `has()` kept returning `true` after a
  `clear()`. It now covers instances and bindings alike.

### Added

#### Several providers per service ID

- **A second registration for an ID no longer displaces the first for good.** Registrations are ranked
  (`ranking`, higher wins; equal ranking keeps the previous last-wins behaviour), and the ones that lose stay
  available: when the visible provider is withdrawn, the best remaining one takes over and consumers see an
  `updated` event rather than the ID falling silent. `unregistered` is reported only when the last provider is
  gone. A provider registering twice under one ID still replaces its own entry instead of accumulating.
- **`register()`, `bind()` and `bindClass()` return a `ServiceRegistration` handle** whose `unregister()`
  withdraws exactly that registration. With several registrations per ID, `unregister(id)` cannot express
  which one is meant; it stays and now means "every registration for this ID". Through the module scope it
  means "all of mine" — otherwise deactivating a module would take other modules' providers along.
- **Cardinality `0..n` / `1..n`**, consumed through `getServiceReferences(id)`, which lists every
  registration best-first **without instantiating any of them**, plus `resolveReference()` to build a chosen
  one and `countProviders(id)`. Collecting must not create objects nobody asked for, which is why it returns
  references rather than services. `cardinality` defaults to `1..1`, or `0..1` when `optional` is set, so
  `optional: true` keeps working as the older spelling of `0..1`.
- **A module with an n-cardinality requirement is only torn down when the last provider is gone**, not on
  every change to the set. This deviates from DS `static`+multiple, which rebuilds the component — for a UI
  registry that would be unusable.
- **`policy: 'dynamic'` reports set changes**, not just presence: a collector hears `onServiceBound` when a
  further provider joins an already non-empty set and `onServiceUnbound` when one leaves. That is what lets a
  palette pick up a widget from a module loaded at runtime without restarting.
- **Two classes may implement the same interface.** An alias from `bindClass(..., { implements })` is a
  registration of its own now, so two implementations rank against each other instead of overwriting; when the
  ranked one goes, the other takes over.
- `ServiceDeclaration.ranking` in the manifest sets the ranking for a declared service; a ranking passed at
  registration time wins over it.
- `DependencyResolver` picks the **highest-ranked** declared provider for a service edge (ties to the first
  declaration), and creates **no** edge for an n-cardinality requirement: the set is filled at runtime, and an
  edge per provider would turn ordinary fan-in into artificial cycles.

#### Selecting a provider

- **`policyOption: 'reluctant' | 'greedy'`** on a requirement. A running module stays with the provider it has
  even after a better-ranked one appears (`reluctant`, the default); `greedy` switches — a static requirement
  rebuilds the module, a dynamic one is reported as unbound and bound again. The distinction only became
  meaningful with ranking; before, there was no "better".
- **Target filters.** `requiresService[].target` takes an LDAP-style filter in OSGi syntax — `(kind=chart)`,
  `(&(kind=chart)(service.ranking>=10))`, `(!(experimental=true))`, `(label=chart*)`, `(kind=*)` — so a filter
  written for a Java `@Reference` reads the same here. Operators `&` `|` `!`, `=`, `>=`, `<=`, `~=`, presence
  and `*` wildcards. An invalid filter throws, naming the position, instead of silently matching nothing.

  Semantics follow `org.osgi.framework.FilterImpl` and are **verified against the OSGi framework TCK**: the
  cases from `AbstractFilterTests` are part of this test suite, so conformance is checked against the reference
  suite rather than against a reading of the spec. Consequences worth knowing:

  - attribute names match **case-insensitively** (`cn` and `CN` are one attribute)
  - comparison is driven by the **type of the property value**, not by the look of the filter text — a string
    property compares lexically even when both sides parse as numbers, so `(version>=10)` holds for `'9'`
  - a property holding an **array matches when any element matches**
  - a **wildcard is a string operation**: `(intvalue=100*)` does not match `1000`
  - booleans have no ordering, and a value the property's type cannot parse never matches, so `(count=)` does
    not match `0`
  - `&`, `|` and `!` are operators **only when a nested filter follows** — `(&=c)` asks about an attribute
    literally named `&`, and `(!  ab=b)` about one named `!  ab`
  - `~=` strips whitespace and compares case-insensitively, the minimum the spec allows

  Not represented, for lack of an equivalent property type: `Character`, `BigInteger`/`BigDecimal` as distinct
  types, `Version`, arbitrary `Comparable`, and filter normalisation (`Filter.toString()`).
- **Service properties.** `register`/`bind`/`bindClass` take `properties`, and `ServiceDeclaration.properties`
  declares them in the manifest (a registration passing its own wins). `service.ranking` and
  `service.providedBy` are added by the registry, so they are filterable too. A filter narrows what satisfies
  a requirement, what `getServiceReferences(id, target)` returns, and what `countProviders(id, target)` counts
  — all without instantiating anything. `getMatching(id, target)` is the filtered counterpart to `get(id)`,
  which stays unfiltered.
- `createServiceFilter(expression)` is exported for use outside the registry.

#### Notification

- **`policy: 'dynamic'` is implemented.** A module requiring a service dynamically stays active when the
  service is withdrawn and is told about it through the new `onServiceUnbound(context, serviceId)` hook;
  `onServiceBound` reports a service that (re)appears while the module runs. Services present at activation
  are not reported as newly bound — `activate()` already sees those. Cardinality still decides activation: a
  mandatory dynamic requirement has to be there to start, its later disappearance does not tear the module
  down. A throwing hook is logged and the module keeps running, which is what the dynamic contract promises.
- **`whenAvailable(id, { timeoutMs })`** resolves once a service is available, immediately if it already is.
  It replaces polling `has()`/`get()` in an interval, which is what a consumer has to do today when it starts
  before the service it needs. Available on the registry and on the module scope; a pending wait is not
  cancelled when a module is deactivated, so pass `timeoutMs` when the service may never arrive.
- **Singletons built with a service are rebuilt when that service changes.** A class bound through
  `bindClass()` receives its dependencies once, at construction, so it would keep serving a replaced or
  withdrawn service. Such instances are now discarded — transitively, so a consumer of a consumer is
  refreshed too — and the next `get()` builds them again.
- **`context.services` can be listened to.** It is typed as `ObservableServiceRegistry` now, so a
  registry-style service inside a module can react to services it never declared — the reactive counterpart
  to collecting providers by hand. The listener is removed when the module is deactivated, so a collection
  cannot keep reacting after its module stopped. A custom `ServiceRegistry` without listener support reports
  that it cannot be observed instead of silently dropping the listener.

#### Satisfaction lifecycle

- **`unsatisfied` module state.** A module whose non-optional `requiresService` entries are unavailable is
  parked instead of failing, and activated as soon as they appear. `error` keeps its old meaning: activation
  was attempted and failed. A parked module is not re-imported when it activates later — only its `activate`
  hook runs.
- **Withdrawal tears the consumer down** (`static` policy). When a required service is unregistered, the
  consuming module is deactivated and parked, so it comes back when the service does. Withdrawing its own
  services in the process is what carries the cascade to indirect consumers.
- **Module-scoped registry.** `context.services` is now a `ScopedServiceRegistry` bound to the module: every
  registration is attributed to it and withdrawn again on deactivation, in reverse registration order. Reads
  pass through unchanged, so a module still sees every service. This is the role `BundleContext` plays in
  OSGi. A module that unregisters in its own `deactivate` hook is unaffected.
- **Service requirements become load-order edges.** `DependencyResolver` now treats a non-optional
  `requiresService` entry as an edge to the module whose `provides` declares that service, in both the
  topological sort and the cycle detection. Optional requirements, services nobody provides, and a module
  requiring what it provides itself create no edge.
- **Dependencies count towards satisfaction.** A module whose declared `dependencies` are loaded but not
  active waits as well, instead of activating against code that is not running.
- `requiresService[].policy` (`'static' | 'dynamic'`, default `'static'`). `'dynamic'` is accepted and
  behaves as `'static'` for now.
- `ModuleLoaderOptions.strictRequirements` restores the previous fail-fast behaviour for missing services.
- `ModuleLoader.settle()` resolves once every queued reaction has run, including those a reaction caused.
  Registry events are synchronous while activation is not, so reactions are queued and serialized; `settle()`
  is what makes startup and tests deterministic. `loadAll()` awaits it before returning.
- `ModuleLoader.getUnsatisfiedModules()` lists every waiting module with what it waits for — the answer to
  "why is this module not running?". `loadAll()` logs the same summary when anything is still waiting.
- A module that activates and parks more than ten times within one cascade is set to `error` instead of
  looping forever.

#### Ownership and observation

- `register(id, service, { providedBy })` records the owning module, as `bind()` and `bindClass()` already
  did. Without an owner on every registration, a teardown cannot tell which entries belonged to a module.
  The parameter is optional, so existing calls are unaffected.
- `ModuleLoader` observes the service registry and emits a `service-withdrawn` module event (with
  `serviceIds`) when a service disappears that an **active** module declared in `requiresService`, along with
  a warning. Observation only: the module is left running, since tearing it down or rebinding it is a
  lifecycle change.
- `ModuleLoader.dispose()` detaches the loader from the registry. Without it the loader's listener outlives
  the loader.
- `ObservableServiceRegistry` — a registry that reports registrations and withdrawals. Kept separate from
  `ServiceRegistry` so custom implementations stay valid without `addListener`; the loader detects support at
  runtime. `ServiceRegistryEvent` and `ServiceRegistryListener` moved to `types.ts` (re-exported from
  `ServiceRegistry.ts`) and are exported from the package root.

### Changed — BREAKING

- **An unmet service requirement no longer throws.** The module is parked in `unsatisfied` and activated when
  the service appears. Code that relied on the rejection needs `strictRequirements: true`.
- **`context.services` is a module-scoped facade, not the shared registry.** It implements `ServiceRegistry`,
  so module code compiles unchanged, but registrations made through it are withdrawn when the module is
  deactivated. A module that deliberately outlived its own services no longer can.
- **`ModuleContext.services` is typed `ObservableServiceRegistry`**, not `ServiceRegistry`. Module code that
  only consumes the context is unaffected; a hand-written `ModuleContext` (in tests, say) needs the two
  listener methods.
- `ModuleState` and `ModuleEvent.type` each gained values (`'unsatisfied'`, plus `'service-withdrawn'`), which
  affects consumers handling those unions exhaustively in a `switch`.

### Changed

- Rebinding a primary ID via `register()`, `bind()` or `bindClass()` now discards the alias bindings of the
  registration it replaces. The alternative — pointing the alias at the new provider — would assign
  interfaces the new provider never declared.
- `ModuleEvent.type` has an additional value (`'service-withdrawn'`), which affects consumers that handle the
  union exhaustively in a `switch`.

#### Build-time manifest validation ([#17](https://github.com/eclipse-daanse/org.eclipse.daanse.tms/issues/17))

- **`tsmPlugin({ manifest, strict })`** checks every `tsm:` import against the manifest while transforming.
  An import of a module the manifest does not declare fails the build with file and line (`strict: false`
  reports it as a warning instead), and a `dependencies` entry no import references is warned about at
  `buildEnd` as a dead declaration. Code and manifest were otherwise two independent sources of truth whose
  mismatch only surfaced on activation, on the user's machine.
- **Type-only imports are exempt**, including `import { type A }` where every specifier is inline `type`: they
  leave no runtime trace, and that they vanish is what makes cross-module typing work without bundling.
- Validation runs in `transform` regardless of `useRenderChunk`, because only a source file can name the line
  an import sits on. An import is accepted when the manifest declares the module ID, the full specifier, or
  its subpath — `tsm:` serves both module imports and host libraries, and insisting on one spelling would
  produce false alarms rather than findings.
- `manifest` takes a path to read or the parsed object; a path that cannot be read fails the build.

#### Diagnostics

- **`getDeclarationMismatches()`** lists services a module declared in `provides` but never registered, and a
  `declaration-mismatch` module event reports the same on activation. This is not cosmetic: the resolver
  derives load-order edges from `provides`, so a declaration nothing backs orders modules after a provider
  that never delivers. `loadAll()` logs a summary, and the list is meant to be asserted in CI.
- `getAll(pattern)` is **deprecated**. It matches ID *names* with a wildcard and sees only services already
  instantiated, so a lazily bound provider is invisible until someone resolves it. Collect providers with
  `getServiceReferences(id, target?)` and select on properties instead of naming conventions.

### Documentation

- `SPEC.md` gained **§11.3 Modul-Konfiguration**: how to cover Configuration Admin's lifecycle semantics with
  what TSM already has — configuration registered as a service per PID, with a mapping table from DS
  (`configurationPolicy`, `modified`, factory configurations) to the equivalent TSM declarations. TSM
  deliberately ships no Config Admin: in OSGi it is a separate specification that SCR merely consumes, and the
  bulk of it is persistence and deployment, which belongs to the application. The one gap is named there too —
  a target filter in the manifest is static, where DS allows configuration to override it.

### Deliberately unchanged

- **`unloadModule()` still refuses when active modules depend on the module** (returns `false`), rather than
  cascading the way a service withdrawal does. Explicit unloading stays the stricter of the two.

### Known limitations

- **Invalidation reaches `bindClass()` only.** What a hand-written `bind()` factory pulls from the registry is
  invisible to it, so such an instance keeps the old service; the same is true for a reference captured in
  module code. `policy: 'dynamic'` reports the change, dropping the reference stays the module's job.
