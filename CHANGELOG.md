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
- `ModuleState` and `ModuleEvent.type` each gained values (`'unsatisfied'`, plus `'service-withdrawn'`), which
  affects consumers handling those unions exhaustively in a `switch`.

### Changed

- Rebinding a primary ID via `register()`, `bind()` or `bindClass()` now discards the alias bindings of the
  registration it replaces. The alternative — pointing the alias at the new provider — would assign
  interfaces the new provider never declared.
- `ModuleEvent.type` has an additional value (`'service-withdrawn'`), which affects consumers that handle the
  union exhaustively in a `switch`.

### Known limitations

- `policy: 'dynamic'` is accepted but behaves as `'static'`. Notifying a module while it keeps running
  requires invalidating cached injections, which is not possible for `bind()` factories whose internals are
  opaque to the registry.
- The registry still holds at most one service per ID, and `getAll(pattern)` sees only instantiated services,
  so cardinality `0..n` — the whiteboard pattern — is not expressible. Satisfaction rules are defined against
  a single provider per ID and will be revisited when that changes.
