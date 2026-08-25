# Changelog

All notable changes to the `@eclipse-daanse/tsm` package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the major version is 0, a minor bump is what carries breaking changes.

## [0.1.0] — 2026-08-24

The release that turns tsm from a module loader into the module and service layer it was aiming at. Measured
against OSGi Release 8 section by section in [`docs/CONFORMANCE.md`](docs/CONFORMANCE.md): of 142 compared
points, 73 conform, 49 differ and 20 are absent — and **every departure now carries a reason** (language,
platform, runtime model, module cut, or a named decision). None is left standing as "not done yet".

What arrived, in the order it builds on itself: **Configuration Admin** and **Metatype** (Compendium 104, 105),
so configuration belongs to the component rather than the bundle. **Requirements and capabilities** (Core 3.3)
with a **system bundle**, so what can run is answerable before anything loads. The **component level** — per
component satisfaction, `@bind`/`@unbind`, factory components, collection references, conditions, and
enable/disable — which is Declarative Services 112 covered but for what rests on a class loader. **Features**
(Compendium 159), the document that answers "which modules, in which versions, with which configuration".
And the two seams that make separately built bundles hold together: **typed service ids** and a **bundle
boundary** the build enforces.

Every issue filed against the package is closed:
[#17](https://github.com/eclipse-daanse/org.eclipse.daanse.tms/issues/17)–[#24](https://github.com/eclipse-daanse/org.eclipse.daanse.tms/issues/24).

### Fixed

- **Decorator metadata was invisible across separately built modules.** The metadata keys were created with
  `Symbol()`, so a module carrying its own copy of the package wrote under keys of its own and every decorator
  applied there was ignored by the loader — silently. They come from the global registry (`Symbol.for()`) now.
  Found by building the example's modules as standalone bundles.
- **A component was constructed before its neighbours were registered.** `startComponents()` registered and
  activated each component in one pass, so a component injecting a service another component of the same module
  offers found nothing. Registration now happens for all of them first, activation second — the two phases DS
  separates for the same reason.
- **Two classes in one module could not offer the same service ID.** The replacement rule from ranking took the
  provider as the unit, so a second `bindClass()` for the same ID replaced the first — but two classes are two
  providers, as they are in OSGi. A registration is identified by provider *and* origin (the class) now, so
  registering the same class again still replaces while a different class accumulates. Found by declaring two
  components under `ui.component` in one module: only one survived.
- **An alias resolved through its ID rather than to its own class.** `bindClass(id, ctor, { implements: [iface] })`
  made `iface` delegate to whatever was visible under `id`, so a later registration there would answer for an
  interface it never claimed. An alias resolves to the registration it was created with now, and disappears
  when that one does.
- **`loadModule()` did not make an unregistered manifest known.** Handing a manifest straight to
  `loadModule()` loaded the module but left `manifests` untouched, so the module scope found no declared
  properties or ranking for it — a service registered by such a module lost the `properties` its manifest
  declared — and `getManifests()` denied the running module existed. The manifest is registered now if it is
  new. Found by loading a view on demand in the workbench example: it activated, registered its component, and
  was never mounted because the declared `region` had gone missing.
- **A module disabled before it ever ran started anyway.** The guard in `loadModule()` only returned an
  existing entry, so a module that had never been loaded fell through and activated — the flag was ignored
  exactly where it mattered most. `loadAll()` now skips disabled modules, `loadModule()` rejects one with a
  clear message, and `enableModule()` loads a module that was disabled before its first start instead of
  leaving it as a manifest without code.
- **A class offered through `implements` could not be described by the manifest.** The module scope applied
  declared properties only to the ID a registration was made under, so the alias registrations from
  `bindClass(id, ctor, { implements: [...] })` got none — and the interface is exactly what consumers filter
  on. `BindClassOptions.propertiesById` now carries properties per ID, filled by the scope from the manifest's
  `provides`, and usable directly for an alias that needs different properties from the class. Found by adding
  a decorated class to the workbench example: it registered its view and was never placed, because the declared
  `region` never reached the interface.
- **Properties declared in a manifest were dropped as soon as the code passed any.**
  `ServiceDeclaration.properties` and the `properties` of a registration replaced each other; they are merged
  per key now, as DS overlays component properties with configuration. The manifest describes where a service
  belongs — deployment information a module should not have to repeat — and the code adds what only it knows.
- **A module was silently not loaded when its ID collided with a global name.** `loadEntry()` returned
  `window[moduleId]` whenever it was truthy, and a browser exposes every element `id` as a global — so an
  `<ul id="palette">` next to a module called `palette` made the loader treat the DOM element as the module
  container. No hook ran, and the module still reported `active`. The same applied to built-in properties like
  `name` or `status`. The value is now checked for being a plausible container (Module Federation `get`/`init`,
  or a namespace with lifecycle hooks or exports, and never a DOM node); otherwise the module is imported
  normally, the global is left alone, and the collision is logged. Found by running the new example in a
  browser.
- **`reloadModule()` only reached the first level of dependents, and skipped parked ones.** Dependents were
  taken from `getDependents()`, which stops at direct dependents, and filtered by `isLoaded()`, which is true
  only for `'active'`. In a chain A ← B ← C, reloading A left C running against replaced code, and a parked
  module kept its old container to activate with later. The whole chain is now reloaded, parked modules
  included, via the new `DependencyResolver.getTransitiveDependents()`; a dependent that cannot be unloaded
  fails the reload instead of leaving it half done.
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

#### Declarative components

- **`@component()`, `@activate()` and `@deactivate()`.** A class declares what it offers, and the loader
  registers and runs it — no `services.register()` in a module's `activate` export:

  ```ts
  @component({ service: [UI_COMPONENT], properties: { region: 'main', order: 1 } })
  export class ClockView {
    constructor(@inject(METRICS_SERVICE, { optional: true }) private metrics?: Metrics) {}
    @activate() start(): void { … }
    @deactivate() stop(): void { clearInterval(this.timer) }
  }
  ```

  This addresses what makes the activator style discouraged in modern OSGi: it forces eager work and keeps the
  declaration beside the code instead of in it. With a component the declaration *is* the registration, so
  `provides` in the manifest becomes optional — and the drift `getDeclarationMismatches()` detects cannot arise
  where there is only one place to state it.
- **Immediate and delayed, as in DS.** A component with an `@activate` method is created when its module
  activates, because something has to run whether or not anyone resolves its service; without one it is created
  on first resolution. `immediate: true` forces the former. An `async` activate method is awaited — that is
  where the synchronous `get()` draws the line, and the distinction resolves it rather than hiding it.
- `@deactivate` runs on the same instance, in reverse creation order, when the module stops — including when a
  withdrawn service parks it. A throwing teardown does not stop the others.
- Both styles work side by side; an imperative `activate` export runs **first**, so it can set up what a
  component gets injected.
- `ServiceRegistry.construct(ctor)` builds an injectable class with its dependencies without registering it —
  what a component that only has a lifecycle needs.
- **`ServiceRegistration.resolve()`** resolves exactly its own registration. With several providers under one
  ID, `get(id)` answers with the visible one; the registrant needs its own. OSGi has the same pair
  (`ServiceRegistration` → `ServiceReference` → `getService`).

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

#### Factory components ([DS 112.2.4](docs/CONFORMANCE.md))

`@component({ factory: 'editor' })` registers a `ComponentFactory` instead of the component's own services;
every `newInstance(properties)` builds one instance with those values. Not to be confused with a factory
*configuration*, which tsm already had — the difference is who decides there should be another one. A factory
configuration is data, so a UI or a stored file creates instances; a factory component is a call, so code does.
"One editor per open tab" is something only the code that opens tabs can know.

The factory follows satisfaction: with a mandatory reference missing it is withdrawn, because nobody should be
able to ask for an instance of something that cannot run. When the reference returns the factory does, but the
instances do not — those belonged to whoever asked for them.

#### Collection references and the field option ([DS 112.3.9](docs/CONFORMANCE.md))

`@injectAll(id, { target, fieldOption })` puts cardinality 0..n on a field and keeps it current while the
component runs — a provider arriving or leaving changes the collection without a rebuild. An empty collection
satisfies 0..n, so it never blocks.

`fieldOption: 'update'` mutates the array the component holds instead of assigning a new one. Its identity
survives, which is what a reactive view bound to it needs: with `replace`, a template holding the old array
never sees the change. `update` asks for the field to be initialised (`= []`); without an array to mutate the
loader says so and assigns. Nothing is assigned when nothing changed, or an unrelated registry event would
make a view re-render.

#### Conditions ([DS 112.3.13](docs/CONFORMANCE.md))

A condition is a service with no behaviour — only the statement that something is the case.
`@component({ satisfyingCondition: conditionFilter('data.loaded') })` waits for one, and
`context.services.register(CONDITION_SERVICE_ID, TRUE_CONDITION, { properties: conditionProperties('data.loaded') })`
makes it hold. Neither side knows about the other, which is the point over depending on a service by name.

Treated as one more mandatory reference, as DS models it, so everything that already waits for a reference
waits for this too. `condition.id=true` is always registered, so a filter has a baseline to be written against.

#### Targeted PIDs ([CM 104.3.2](docs/CONFORMANCE.md))

`pid|moduleId|version` configures a PID for one module, or for one version of it. The lookup runs from the most
specific to the least, and the first configuration **with values** wins — an empty entry does not end the
search, because `getConfiguration()` creates those and one of them must not shadow a configuration that has
values. What it buys is a rollout: the new version gets its own configuration while the old one keeps running
on the untargeted one. OSGi's `location` segment has no counterpart; a module has no install location.

#### Filtering listeners and `modified-endmatch` ([Core 5.6.1](docs/CONFORMANCE.md))

`addListener(listener, { filter })` narrows what a listener hears — and, uniquely, tells it when a service
*stops* matching. That is the whole reason to filter there rather than in the callback: a listener testing
properties itself never learns that a service it had accepted no longer qualifies, so whatever it collected
goes stale in silence.

### Changed — BREAKING

Seven of these change *behaviour* rather than types, so a build that still compiles can still behave
differently. They are listed first.

- **A tie in ranking now goes to the earlier registration.** OSGi is explicit — "ties give a preference to the
  earlier registrant" (Core 5.2.5) — and tsm did the opposite. The reason it is worth matching: with the later
  one winning, merely loading another module displaces a running provider, so which service answers depends on
  load order. A provider that means to win says so with a ranking. **What to check:** anywhere two providers of
  one id share a ranking, the selection reverses. `getServiceReferences()` and `getServices()` order the same
  way, so a collection sees the reversal too.
- **An outranked registration now raises events.** Registering or withdrawing a provider that is not the
  visible one used to be silent, because `get(id)` answered with the same object either way. But
  `countProviders` had changed, and a collection reference consumes every provider — cardinality 0..n went
  stale in silence. Both directions notify now, as OSGi raises REGISTERED and UNREGISTERING per registration.
  **What to check:** a listener counting `registered`/`unregistered` events per id will see more of them.
- **A `default` export no longer wins over a contributing namespace.** Entry resolution preferred
  `module.default ?? module`. A library bundle may carry a genuine default export for its consumers, and taking
  it as the container hid the `activate`/`deactivate` — or the `@component()` classes — exported next to it: the
  module counted as active while contributing nothing. The namespace wins whenever it exports a lifecycle or a
  component; `default` stands in only for default-export-style modules.
- **The entry import no longer passes through a bundler transform.** A dev server rewriting the call gives the
  entry its own URL (vite appends `?import`), and a different URL is a different module instance — the loader
  activated one while every bare import through an import map read another. The fetch goes through a
  Function-wrapped native import instead, so module identity stays URL identity.
- **`tsmPlugin({ boundary })` fails builds that used to pass.** A file pulled in from outside the bundle is now
  an error, and always an error rather than a warning under `strict: false`: an undeclared dependency costs a
  needless module load, a file copied across a boundary is structurally wrong. Enabled when the manifest is
  given as a path; `boundary.allow` is where an exception is written down, and the contract module is what
  belongs there. **What to check:** in a monorepo this typically surfaces framework or contract code that was
  being copied into every bundle.

- **An unmet service requirement no longer throws.** The module is parked in `unsatisfied` and activated when
  the service appears. Code that relied on the rejection needs `strictRequirements: true`.
- **`context.services` is a module-scoped facade, not the shared registry.** It implements `ServiceRegistry`,
  so module code compiles unchanged, but registrations made through it are withdrawn when the module is
  deactivated. A module that deliberately outlived its own services no longer can.

Type-level changes:

- **`register`, `bind` and `bindClass` bind the value's type to the id.** With a `ServiceId<T>` the id decides
  the contract and the value has to conform (`NoInfer<T>`); registering something else is now a compile error
  where it used to infer a union. A plain string id is unaffected — the brand is optional, so every existing
  call still typechecks.
- **`ServiceScope` gained `'module'`.** `'singleton' | 'transient'` is now a named type with a third member,
  which affects code matching on the union exhaustively.
- **`ServiceRegistryEvent.type` gained `'modified-endmatch'`**, and the event carries an optional `properties`.
  A `switch` over the union that was exhaustive no longer is.
- **`ComponentInfo` gained `collections`** (required) plus `satisfyingCondition` and `factory` (optional).
  Reading it is unaffected; code *constructing* one — a test double, say — needs the new field.
- **`ComponentOptions.service` is `readonly`** and accepts `ServiceId<unknown>`. Assigning the array elsewhere
  as `string[]` needs a copy.
- **`ModuleContext.services` is typed `ObservableServiceRegistry`**, not `ServiceRegistry`. Module code that
  only consumes the context is unaffected; a hand-written `ModuleContext` (in tests, say) needs the two
  listener methods.
- `ModuleState` and `ModuleEvent.type` each gained values (`'unsatisfied'`, plus `'service-withdrawn'`), which
  affects consumers handling those unions exhaustively in a `switch`.
- **`verbatimModuleSyntax` is on for the package's own build.** Not part of the published API, but a consumer
  copying the tsconfig gets stricter import syntax with it.


### Changed

- Rebinding a primary ID via `register()`, `bind()` or `bindClass()` now discards the alias bindings of the
  registration it replaces. The alternative — pointing the alias at the new provider — would assign
  interfaces the new provider never declared.
- `ModuleEvent.type` has an additional value (`'service-withdrawn'`), which affects consumers that handle the
  union exhaustively in a `switch`.

#### Component declarations at build time

- **`tsmPlugin({ components: 'validate' | 'derive' })`** reads the `@component()` declarations out of the
  sources. `validate` compares them with the manifest's `provides` and reports what is missing or stale;
  `derive` emits a manifest whose `provides` is generated from them, so the declaration exists in exactly one
  place.

  The loader reads the declarations at runtime anyway. This is for everything that has to know them *before* a
  module is imported: load order, satisfaction, and whether a set of modules is self-sufficient. In OSGi bnd
  generates descriptors for the same reason — a resolver cannot load a bundle to find out what it offers.
- The scan uses the TypeScript AST rather than patterns, because `@component({ … })` carries nested object
  literals. A service ID may be a string literal, a `const` in the same file, or a `const` in a relatively
  imported module — otherwise the build fails naming file, line and reason instead of silently deriving
  nothing.
- **A `@component()` class that is not exported is reported.** The loader finds components in the module's
  namespace, so an unexported one is never registered — and nothing at runtime can say why, because the class is
  not there to be found. This is decidable only from the source, which is where it is now checked.
- Two components declaring one service ID differently are reported: `provides` holds one entry per ID, so the
  manifest cannot express both.

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

#### DevTools

- **New subpath export `@eclipse-daanse/tsm/devtools`** with `installDevtools({ loader, registry?, resolver?,
  runtime? })`, which puts console commands on `globalThis.tsm`: `modules()`, `manifest()`, `state()`,
  `load()`/`unload()`/`reload()`/`loadAll()`, `unsatisfied()`, `mismatches()`, `services()`, `service()`,
  `providers(id, target?)`, `shared()`, discovery and repository commands, a load queue, and `help()`.
  Adapted from the `tsm-devtools` module in the Eclipse Daanse gene application.

  It was written against an application-side `tsm.system` facade and had to restate four TSM interfaces
  structurally to do so — which had already drifted (`getBindingInfo` was typed `scope: string` there, against
  `'singleton' | 'transient'` here). Taking the commands into this repository removes the restatements and ties
  them to the introspection API they depend on: `getUnsatisfiedModules()`, `getDeclarationMismatches()`,
  `getServiceReferences()` and `countProviders()` did not exist when it was written, so it could not use them.
- Output goes through a `DevtoolsOutput` sink — `consoleOutput()` with colours by default, `collectingOutput()`
  for tests, so a command can be asserted without a browser. `target: null` installs nowhere and returns the
  command object; `name` changes the property.
- `load()` passes `awaitCascade`, so after it returns the modules it satisfied are active too, and a parked
  module reports what it waits for right away.
- **`ModuleLoader.getManifests()`** returns every registered manifest, loaded or not. `getLoadedModuleIds()`
  answers what runs; a listing needs what is known, in order to show a module as not loaded.

#### Switching modules off

- **`disableModule()` / `enableModule()`**, plus `isDisabled()` and `getDisabledModules()`. Deactivating alone
  does not last: the module is satisfied, so the next reconcile brings it back. Disabling is a separate
  dimension from the state — as with DS component `enabled` — so a module stays stopped until it is enabled
  again. Its services are withdrawn on the way, so consumers are parked through the usual cascade, and
  `loadModule()` refuses to activate a disabled module. This is what makes a manual stop meaningful, for
  instance from a console.
- **`getServiceConsumers(serviceId)`** names the modules that declared a requirement on a service, with their
  state and how they asked (cardinality, policy, target). The counterpart to `getBindingInfo().providedBy`,
  which answers who offers a service — `inspect service` in OSGi terms. Derived from the manifests, so modules
  that never loaded are included.
- DevTools gained `disable(id)`, `enable(id)` and `consumers(id)`, and `modules()` marks a disabled module as
  such.

#### Diagnostics

- **`loadModule(manifest, { awaitCascade: true })`** returns only once the cascade it triggered has run, so the
  whole picture is stable — what OSGi gets for free, where a service registration is delivered synchronously
  and `registerService()` returns with the consequences already applied. Here the cascade has to be queued,
  because `import()` is asynchronous and a synchronous registry listener cannot finish an activation that
  awaits one. No timeout: the loader knows how many reactions are outstanding, so the wait is exact rather
  than a guess. Off by default, and not to be set from a lifecycle hook.
- `settle()` documents what it is for and its one rule: `loadAll()`, `unloadModule()` and `reloadModule()`
  await it themselves, after a single `loadModule()` the caller has to, and it must not be called from a
  lifecycle hook — a hook runs inside the cascade it would wait for. Detecting that from inside would need
  async context tracking, which is not available in a browser, so it is a documented rule rather than a guard.

- **`getDeclarationMismatches()`** lists services a module declared in `provides` but never registered, and a
  `declaration-mismatch` module event reports the same on activation. This is not cosmetic: the resolver
  derives load-order edges from `provides`, so a declaration nothing backs orders modules after a provider
  that never delivers. `loadAll()` logs a summary, and the list is meant to be asserted in CI.
- `getAll(pattern)` is **deprecated**. It matches ID *names* with a wildcard and sees only services already
  instantiated, so a lazily bound provider is invisible until someone resolves it. Collect providers with
  `getServiceReferences(id, target?)` and select on properties instead of naming conventions.

#### A failed activation discards one component, not the module

An `@activate` that throws used to propagate: the module went to `error` and its other components were never
activated at all. DS is explicit — "the component configuration is not activated and will be discarded"
(112.5.8) — and it is what keeps one broken plugin from taking an application with it. The component's services
are withdrawn with it, because a registration whose object never finished starting would hand consumers a
half-initialised thing, and `ComponentConfigurationInfo.state` gained `'failed-activation'`: neither active nor
waiting, which is what whoever has to find out why needs to see.

#### A component's declaration read through constants

The build-time scan resolves a service id held in a constant from **another package** — the API bundle, where a
contract belongs — and reads it through an identity call it knows by name (`serviceId`, `Symbol.for`) as well as
through `as const` / `satisfies`. Both halves are needed: a typed id is a call, not a literal, so without the
second the declaration silently lost its `provides` entry.

`node_modules` is walked by hand rather than through a resolver, because the scan is synchronous and
`import.meta.resolve` does not exist under Vite. The `types` condition is tried first — a workspace API package
usually points at its TypeScript source, and built output is no use before it is built.

Property keys resolve through constants too, in `properties` as well as `propertiesById`, so a property name
can live in the contract module alongside the service id.

### Documentation

- **New subpath export `@eclipse-daanse/tsm/decorators`** — just the decorators and their metadata. A
  separately built module needs them at runtime, and importing the package root would pull the whole loader
  into every bundle.
- **Configuration Admin, bound to components** (`ConfigurationAdmin`, `@component({ configurationPid, configurationPolicy })`,
  `@modified()`): configuration by PID, with the lifecycle DS attaches to it. `configurationPolicy: 'require'` holds a
  component back until its PID exists — while the module around it stays active, which is the separation OSGi draws
  between the framework and SCR. A change calls `@modified()` if there is one and only updates the service properties
  otherwise; without `@modified()` the component is rebuilt, as in DS. Configuration merges over the component's
  declared properties and becomes the service properties, so a consumer's target filter selects on it; keys starting
  with a dot stay private, and `service.ranking` from configuration re-orders providers without touching code. A PID
  that names a *factory* PID instantiates the component once per configuration — not a separate feature, the same
  mechanism, exactly as it follows from the PID in DS.
- **Breaking: `window[moduleId]` is gone.** A module is handed over explicitly now — `loadModule(manifest,
  { container })` for one, `new ModuleLoader({ entryResolver })` for many — or fetched from its `entry` URL. Migrating
  from the old path is one line per call site (#19).
- What that removes: collisions with DOM ids, which the browser exposes as globals — `<ul id="palette">` was taken as
  the module `palette`, and the `isModuleContainer` guard existed only to fend that off; a shared namespace between two
  applications on one page; and the reason the loader could not run in Node at all, where `window` does not exist. It
  does now: `loadModule` works in a plain Node process, and `import()` takes `file:` and `data:` URLs there.
- Also removed: the half of Module Federation that was in there. `container.get(export)` was called,
  `container.init(shareScope)` never — so a real remote could not have worked, and `SPEC.md` §2 excludes Module
  Federation from the scope anyway.
- A handed-over container is kept for `reloadModule()`, so a module with no fetchable URL restarts on the same code;
  the cache buster is only applied where there is a URL. `unloadModule()` lets go of it. The test suite dropped its
  `globalThis.window` fakes in the process — 10 files' worth, plus a window proxy that only existed to survive the
  unload.
- **New example `examples/wiring`** (`npm run example:wiring`): the resolution computed from manifests alone, with
  nothing loaded — a capability that is not a service (`demo.theme` with attributes), a requirement selecting on it by
  filter and `versionRange`, `cardinality: 'multiple'` wiring to every match, and side by side the two cases only the
  resolution can tell apart: a module waiting for a service somebody promises, and one waiting for a service nobody
  does. Pressing *load* then fetches only what resolves.
- **`WiringResolution.requirements`** pairs each requirement with its wires or its failure (`RequirementReport`).
  Necessary because the requirements derived from `dependencies`, `requiresService` and `sharedDependencies` are fresh
  objects on every `requirementsOf()` call — a consumer matching a `Wire` against one it fetched itself found nothing,
  silently. Building the example is how that surfaced.
- **Shared libraries now follow the manifest.** `createTsmExternals(manifest)` externalizes what
  `sharedDependencies` declares instead of deciding from lists kept in the build config, and
  `tsmPlugin({ manifest })` **fails the build** when a declared library's code is found in a chunk anyway. That was
  the one place the failure could be caught: a bundled copy means the module gets its own instance — two Vue
  reactivity systems, `provide`/`inject` not crossing the boundary — and at runtime nothing notices, because
  `validateSharedDependencies` only asks whether the *host* has the library, not whether the module uses it. The older
  `createTsmExternals('module-id', …)` form still works.
- **Import maps** (`generateImportMap`, `importMapScript`, `installImportMap`, `sharedLibraries: 'import-map'`) as the
  standard alternative to `__tsm__.require()`: modules simply `import` their libraries and the host decides the URL. A
  map knows names and URLs but nothing of `^3.4.0`, so `generateImportMap` does that check while it still can — it
  reads every manifest's `sharedDependencies` and reports what is `missing` or `incompatible` before the map is
  installed. `scopes` are deliberately not generated: they could hand two modules different versions, which is the
  problem sharing exists to avoid.
- Documentation fix: the README showed `createTsmExternals(['vue', 'primevue'])`, an array the signature never took.
- **`@bind()` / `@unbind()`** make a reference dynamic (DS 112.3.2, 112.5.18): the component stays and is handed the
  change, where an `@inject()` reference means a rebuild. The decorator names the method by sitting on it, rather than
  in XML as DS must. Bind runs before `@activate` and in declaration order, receives the service and the
  `ComponentContext`, and a failure is logged rather than thrown. A mandatory reference going means the component goes
  — after being told; an optional one only gets the call. Without an `@unbind` the loss is reported and the component
  keeps what it stored: stopping it would turn an optional reference into a mandatory one.
- **`disableComponent()` / `enableComponent()`** (DS 112.5.1) switch one component off while its module and siblings
  keep running — a dimension of its own at both levels, so no reconciliation brings it back. The switch survives a
  `reloadModule()`, because it belongs to the deployment rather than the instance, and may be set before the module is
  ever loaded. `getDisabledComponents()`, and `tsm.disableComponent(id, class)` in the console.
- **`dependencies: 'derive'`** in the Vite plugin (the last point of #17): the manifest's dependencies are written from
  the modules the code actually imports, so the declaration exists in one place. `tsm:` imports of shared libraries
  are left out — the module depends on the host providing them, which `sharedDependencies` says — as are type-only
  imports. With `components: 'derive'` both write **one** manifest; two emits under the same name would have
  overwritten each other.
- **Satisfaction per component** (DS 112.5.2): what a component injects with `@inject()` is now its own
  requirement. A missing service leaves it `unsatisfied-reference` — `getComponents()` names it in `waitingFor` —
  while the module keeps running; the service arriving starts it, the service leaving stops it through `@deactivate`
  and withdraws its own services, which cascades to whatever injected those. Before this, a missing service **threw**
  and took the whole module's load with it: `Dependency 'demo.tiles' not found`. `requiresService` in the manifest
  stays the coarser tool, for when a module has no purpose without the service.
- Components of one module are now registered in rounds, since one may inject the service another offers and the order
  inside a module says nothing about which comes first — the same fixpoint the module level uses. Activation then
  follows the registration order rather than the declaration order: otherwise a consumer starts while its provider is
  constructed but not yet activated, which the round-based registration made visible.
- **A system bundle** (`getSystemBundle()`, `systemCapabilities`), which is how OSGi answers the same question:
  *"In addition to normal bundles, the Framework itself is represented as a bundle"* (Core 4.6). The environment gets
  the shape of a module, so the resolver needs no special case — it knows modules with capabilities, and one of them is
  the runtime. It carries the registered shared libraries and whatever the host declares, which is the counterpart to
  `org.osgi.framework.system.capabilities.extra`; the specification's own screen example works verbatim. Its id is
  `system.bundle` and its entry the fixed string `System Bundle`, as `getLocation()` returns there. It takes part in
  `getWiring()` by itself, appears in `tsm.capabilities()`, stays out of `getManifests()` — which answers what was
  registered — and refuses to be loaded, the way its `start()` does nothing in OSGi.
- **Fixed:** a module declaring `sharedDependencies` could never resolve. The requirement is derived from its
  manifest, but the library is registered with the runtime — outside the model — so nothing offered the `tsm.library`
  capability and `getUnresolvedModules()` reported the module as unable to ever run. `resolveWiring(manifests,
  { offered })` now takes capabilities that come from no manifest, `libraryCapabilities()` builds them from what the
  runtime holds, and `getWiring()` supplies them itself. A library may equally be a module that declares the
  capability, which is what a shared library is in OSGi — a bundle exporting a package.
- **Requirements and capabilities** (OSGi Core 3.3): a module offers `capabilities` in a namespace and asserts
  `requirements` about them, with `filter`, `versionRange`, `resolution` and `cardinality`. What the manifest already
  said is derived into the same model rather than living beside it — every module has an `osgi.identity` capability,
  `provides` becomes `osgi.service`, `dependencies` and `requiresService` become requirements — so there is one
  mechanism instead of four, and both ways stay valid.
- Resolution is **static**, over manifests, before anything loads, which yields the distinction that was missing:
  `getUnsatisfiedModules()` reports a module *waiting*, `getUnresolvedModules()` reports one waiting **in vain**
  because no manifest even promises what it needs. The specification draws the same line — a capability in the
  `osgi.service` namespace is "a promise" at resolve time (Compendium 135.4) — so `requiresService` remains the
  runtime question. Also `getWiring()` and `getModuleWiring(id)`, plus `tsm.capabilities()`, `tsm.wiring(id)` and
  `tsm.unresolved()` in the console, which is Gogo's `inspect`.
- Two departures, both deliberate: a requirement's filter matches attribute names **case sensitively**, as Core 3.3.6
  asks and unlike service properties (`createServiceFilter(expr, { caseSensitive: true })`); and versions are compared
  with a semver `versionRange` beside the filter rather than inside it, because a filter compares text and
  `(version>=1.9.0)` would accept `1.10.0` only by accident.
- **Metatype** (`objectClass()`, `MetatypeRegistry`, `@component({ configurationSchema })`): configuration describes
  itself — names, types, defaults, ranges, options — so a generic user interface can offer a form for a PID nobody
  wrote a form for. OSGi's Compendium 105, with one thing working out better than in Java: there a configuration needs
  an annotated interface for the type *and* annotations for the description, and the two can drift; here the schema is
  a value and `ConfigurationOf<typeof schema>` derives the type from it. Type-level tests keep that inference honest
  (`npm run typecheck:types`).
- Two effects that are felt rather than merely described. **Declared defaults are applied** underneath the
  configuration — where bnd puts the defaults of an annotated configuration type — so a component reads a value
  instead of inventing one, and they become service properties like any other value. And **values are checked**: hand
  the registry to `ConfigurationAdmin` and an `update()` that does not fit the schema is refused. That check is a
  deliberate departure — in OSGi, Config Admin does not validate and Metatype only describes — and it is opt-in, since
  without a registry nothing changes.
- `required` defaults to **true**, as in OSGi, and a declared default stands in for a missing value. Localization
  follows OSGi's mechanism: `%key` resolved per locale, with an untranslated key keeping its `%key` form rather than
  turning into an empty label. `MetatypeRegistry` is a service (`tsm.metatype`), so a configuration UI can be a
  module; `tsm.describe(pid)` shows attributes, ranges, current values and what does not fit.
- **`toJsonSchema()` / `toMetamodelSchema()`** are the way out of tsm's own vocabulary. Rather than growing an Ecore
  generator, tsm emits JSON Schema (Draft 2020-12) and `@emfts/codec.jsonschema` turns it into an EPackage — from
  where `@emfts/vue-registry` and `@emfts/uimodel-composer` render the interface, with no UI code and no EMFTs
  dependency in tsm. Two forms for two questions: `toJsonSchema` describes a *document* (what a validator or form
  library wants), `toMetamodelSchema` describes *classes* under `$defs` (what an EPackage converter reads — it ignores
  a top-level object schema). Verified against the real converter: three EClasses with correct bounds and a named
  `EEnum`. `validate()` cannot survive the trip — a function is not expressible in any schema language, so only
  `x-tsm-validated` records that a check exists; an OCL constraint is where such a rule belongs on the model side.
- **New example `examples/config`** (`npm run example:config`): the same PID shown deciding three different things —
  a component held back while its bundle stays active (and the consumer bundle parked behind it), two components on
  one PID where only one has `@modified()` so their tick counts diverge on a single change, and a factory PID turning
  one class into two providers. Values persist in `localStorage`, so a reload shows what `ready()` is for. Building it
  found the instance-identity bug above.
- **`ConfigurationStore`** is the one pluggable part, which is the seam the OSGi specification itself draws: it
  requires that configuration survives a restart and leaves the medium open. `MemoryConfigurationStore` and
  `LocalStorageConfigurationStore` are included; `loadAll()` awaits `ready()` so a component whose values are already
  stored starts straight away instead of being parked and woken.
- **`ServiceRegistration.setProperties()`** changes the properties of a live registration without withdrawing it —
  OSGi's method of the same name, and what lets `@modified()` avoid a rebuild. A ranking passed with it re-decides
  which registration for an ID is the visible one. Also `ServiceRegistration.key`, the identity a reference carries,
  so a registrant can find its own among an ID's providers.
- **`BindClassOptions.instanceKey`** lets one class hold several registrations under one ID, which is what a component
  instantiated per factory configuration needs; without it the second registration replaces the first.
- **Fixed:** a component that started *without* configuration and received some later was torn down and rebuilt
  instead of being handed the new values, because instances were keyed by their PID — so "no PID yet" and "this PID"
  looked like different instances rather than one whose values changed. Only a factory configuration makes the PID an
  identity; for an ordinary PID there is one instance either way, as in DS. Found by the example, not by reasoning:
  two components on one PID, and the one with `@modified()` was restarting too.
- **Fixed:** withdrawing a *shadowed* registration left its alias registrations in place, so an interface kept
  pointing at a registration that was gone. Only the visible branch cleaned them up.
- **`getComponents()`** now reports what became of each declaration, mirroring DS' split between a component
  *description* and its *configurations*: `configurationPid`, `configurationPolicy`, `hasModified`, and one entry per
  instance with its state (`unsatisfied-configuration`, `satisfied`, `active`) and properties.
- **Devtools:** `components(id?)` (DS' `scr:list`), plus `config(pid?)`, `configure(pid, values)` and
  `unconfigure(pid)`, which settle the loader's queue before reporting.
- **New example `examples/graph`** (`npm run example:graph`): the three layers — bundles, their components, the
  services between them — drawn as SVG from the running loader. Every box and edge comes from `getManifests()`,
  `getComponents()`, `getServiceReferences()` and `getServiceConsumers()`, so pressing a button changes the
  picture: a higher-ranked provider turns the previous one's edge grey (standing by), disabling a provider makes
  its consumer wait, and a bundle whose service nobody offers stays parked with no components at all — its
  classes are loaded but were never registered.
- **`ModuleLoader.getComponents(moduleId?)`** lists the `@component()` classes of the loaded modules with what
  each declared: services, immediate or delayed, which lifecycle methods it has. A service reference names the
  module that provided it, never the class, so this was the missing view — DS offers it as `scr:list`.
- **New example `examples/workbench`** (`npm run example:workbench`): UI components that come and go while the
  shell keeps running. It distinguishes two mechanisms a workbench needs — a *region* collects every
  contribution (`0..n`, ordered by an `order` property), while a *slot* has several modules competing for one
  place and shows the highest ranked. `unmount()` releases what `mount()` acquired, and the test proves it by
  keeping a reference to the detached element and advancing the clock: a leaked interval would keep writing
  into it. A churn button loads and unloads a view every 2.5 seconds. One module registers decorated classes
  through `bindClass()` — every view is a decorated class, including one with `@inject(id, { optional: true })`
  to show that optional injection is decided at the injection point while `requiresService` decides whether the
  module may activate at all. This also settles a question the examples left open:
  `@inject` names the service ID explicitly, so no type reflection is involved and `experimentalDecorators`
  suffices — esbuild's missing `emitDecoratorMetadata` does not matter, and decorators need no extra setup
  under Vite.
- **New example `examples/whiteboard`** (`npm run example:whiteboard`): six modules that find each other
  through services, no framework and no separate install, running against the package sources. It shows load
  order following from the manifests rather than from the registration order, a `0..n` collection with
  `properties` instead of a hand-written registry, a set growing at runtime through `policy: 'dynamic'`,
  default and override by `ranking` with `disableModule()`, and the devtools in the console. A parked module is
  included on purpose, so `unsatisfied()` has something to report.
  `src/__tests__/example-whiteboard.test.ts` runs the example without a browser and asserts each of those.
- DevTools gained `lb()` and `ls()` as aliases for `modules()` and `services()`, named after the Gogo shell.
- `npm run typecheck:examples` type-checks the examples, and `npm run lint` covers them too — example code was
  outside both before.

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
- **A service id can lie about its type.** `serviceId<Widget>('demo.tiles')` is a mismatch no compiler can
  catch, where a Java class name cannot lie. The contract is one file, written once and imported thereafter,
  which is where the honesty has to come from.
- **SCR cannot be stopped or swapped.** The loader is framework and service component runtime in one object, so
  "stop all components, leave the bundles running" exists only per component, through `disableComponent()`.
  Introspection *is* a service (`tsm.component.runtime`), so a component view can still be a module.
- **What rests on a class loader has no counterpart**, and will not: package wiring, `uses` constraints, class
  space consistency, fragments, refresh, multiple versions of one module at runtime. ES modules resolve their
  own imports. `docs/CONFORMANCE.md` names each one.
