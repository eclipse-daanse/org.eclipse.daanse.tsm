# Conformance to the OSGi specifications

What tsm implements of OSGi Release 8, section by section, and where it departs —
with the reason, because the reasons are not all of one kind. Fetch the
specifications with `npm run docs:osgi` to read along; the section numbers are
theirs.

Scope: **Core 3.3** (Requirements and Capabilities), **Core 4** (Life Cycle
Layer), **Core 5** (Service Layer, incl. 5.8 Filters), **Compendium 104**
(Configuration Admin), **105** (Metatype) and **112** (Declarative Services). The
rest of Core 3 rests on a class loader and is listed at the end as such.

| | |
|---|---|
| **✅** | conform in substance |
| **◐** | present, but different |
| **✗** | absent |

The **Art** column says what kind of difference it is:

| | |
|---|---|
| **Sprache** | follows from TypeScript instead of Java, and would be wrong to copy |
| **Plattform** | follows from the browser instead of a JVM |
| **Laufzeit** | follows from asynchronous module loading |
| **Modell** | follows from the loader being framework and SCR in one |
| **Absicht** | deliberately left out or done differently; the reason is in `SPEC.md` |
| **Lücke** | missing without a reason of principle — buildable. No row carries this any more |

---

## Core 5 — Service Layer

| § | Concept | tsm | | Art |
|---|---|---|---|---|
| 5.2.1 | Service References | `ServiceReference` with `key`, `properties`, `ranking`, `instantiated` | ✅ | |
| 5.2.2 | Service Interfaces | `serviceId<T>('demo.tiles')`: a string carrying the contract as a phantom type | ◐ | Sprache — a TS interface does not exist at runtime, so a service is named by a string; the id and the contract are declared together, so a consumer writes one name and a mismatch is a compile error. What stays absent is a *canonical* name — a string can lie about its type where a class name cannot |
| 5.2.3 | Registering Services | `register`, `bind`, `bindClass` | ✅ | |
| 5.2.4 | Early need for ServiceRegistration | the handle is returned before anything resolves it | ✅ | |
| 5.2.5 | Service Properties | `string \| number \| boolean` and arrays of those | ◐ | Sprache — Java takes any object in a `Dictionary`; tsm restricts to what a filter can match and a store can write |
| 5.2.6 | Service Ranking Order | `ranking`; on a tie the **later** registration wins, where OSGi prefers the **earlier** one ("ties give a preference to the earlier registrant") | ◐ | Absicht — before ranking existed, a repeated registration replaced its predecessor, and that was kept. Consequence: with two unranked providers of one ID, OSGi shows the first, tsm the second |
| 5.2.7 | Persistent Identifier | `service.pid`, set by Configuration Admin | ✅ | |
| 5.2.8 | Locating Services | `get`, `getRequired`, `getServiceReferences`, `getMatching` | ✅ | |
| 5.2.9 | Getting Service Properties | on the reference, plus `service.ranking` / `service.providedBy` | ✅ | |
| 5.2.10 | Information About Services | `getBindingInfo`, `countProviders`, `getServiceConsumers` | ✅ | |
| 5.2.11 | Service Exceptions | plain `Error`, no typed `ServiceException` | ◐ | Sprache — no checked exceptions to distinguish |
| 5.2.12 | Services and Concurrency | nothing to synchronise | ✅ | Sprache — one thread |
| 5.3 | Service Scope | `singleton`, `module`, `transient` | ✅ | `module` is OSGi's `bundle` scope under the name tsm uses for a bundle; a service's own references resolve for the module that provides it |
| 5.4.1 | Getting a Single Service Object | `get(id)` | ✅ | |
| 5.4.2 | Getting Multiple Service Objects | `transient` hands out a new instance per resolution | ◐ | Sprache — as 5.5: several objects are had by resolving several times, but there is no handle to release one, because GC needs none |
| 5.5 | Releasing Service Objects | nothing to release | ◐ | Sprache — reference counting exists because Java has no GC boundary here; the cost is that a transient service is never told it is done with |
| 5.6.1 | Service Event Types | `registered`, `updated`, `unregistered`, `modified-endmatch` | ✅ | a listener may be added with a filter, which is what makes the end of a match observable |
| 5.7 | Stale References | `invalidateInjectors` discards singletons built with a service that changed | ◐ | Sprache — mitigated, not guaranteed: a module holding a reference keeps the object alive, and nothing can revoke it the way an unregistered Java service can be made to throw |
| 5.8 | Filters | `serviceFilter.ts`, checked against Felix `FilterImpl` and its TCK | ✅ | |
| 5.9 | Service Factory | `module` scope: one instance per consuming module, built on its first resolution | ◐ | Sprache — the semantics are 5.3's `module` scope; what is absent is the `getService(bundle, registration)` callback shape, since the factory needs no argument to be given a consumer |
| 5.10 | Prototype Service Factory | `transient` gives a new instance per resolution | ◐ | Sprache — close in effect, not in contract: no `ServiceObjects` handle, because releasing is GC's business |
| 5.11 | Unregistering Services | `registration.unregister()`; the best remaining registration takes over | ✅ | |
| 5.13.1 | Service Permission | none | ✗ | Plattform — no boundary between modules in a browser to enforce |

## Core 4 — Life Cycle Layer

| § | Concept | tsm | | Art |
|---|---|---|---|---|
| 4.2 | Frameworks, launching, embedding | `ModuleLoader` is a library, not a framework with a launch API | ◐ | Plattform |
| 4.2.x | Start Levels | `priority` in the manifest orders loading, nothing more | ◐ | Absicht — start levels exist to sequence a whole system; load order suffices here |
| 4.4.1 | Bundle Identifiers | the manifest `id`, no numeric identity | ◐ | Sprache/Absicht |
| 4.4.2 | Bundle State | `registered`, `resolving`, `loading`, `activating`, `active`, `unsatisfied`, `deactivating`, `stopped`, `error` | ◐ | Modell — no `RESOLVED` (there is no wiring step), and `unsatisfied` is an extra tsm needs because it parks modules DS would leave to components |
| 4.4.3 | Installing Bundles | `register(manifests)` | ✅ | |
| 4.4.4 | Resolving Bundles | `DependencyResolver` — order, cycles, missing | ◐ | Modell — no wiring, see Core 3 below |
| 4.4.5 | Starting Bundles, persistent start | `loadModule`; the started state does not survive a reload | ✗ | Plattform — persistence is the application's, as `ConfigurationStore` shows |
| 4.4.6 | Activation, lazy activation | components are immediate or delayed; bundles are always eager | ◐ | Plattform — lazy bundle activation needs a class-loading hook, which ES modules do not offer |
| 4.4.7 | Stopping Bundles | `unloadModule`, `disableModule` | ✅ | |
| 4.4.9 | Updating Bundles | `reloadModule`, with dependents | ◐ | Plattform — no version negotiation on update, because there is no second version to negotiate with (see Core 3.6) |
| 4.4.10 | Uninstalling Bundles | `unloadModule` withdraws services and stops components | ✅ | |
| 4.4.13 | Loading Classes | ES module resolution | ✗ | Plattform — no class loader, so no per-bundle isolation |
| 4.4.14 | Access to Resources | none | ✗ | Plattform — a module is not an archive |
| 4.5 | The Bundle Context | `ModuleContext`: scoped registry, logger, module access | ✅ | |
| 4.5.2 | Persistent Storage | none | ✗ | Plattform |
| 4.6 | The System Bundle | `system.bundle` with the fixed `System Bundle` location, taking part in the resolution, refusing to be loaded | ◐ | Modell — the capability side is there and the name is the one OSGi requires as an alias; what is absent is the lifecycle side, where `stop()` shuts the framework down. A loader is a library, not a runtime to shut down |
| 4.7.1 | Listeners | `ModuleEventListener`, `ServiceRegistryListener` | ✅ | |
| 4.7.2 | Delivering Events | synchronous listeners; reactions run in a serialised queue | ◐ | Laufzeit — `import()` is async, so a reaction cannot run inside the event |
| 4.7.3 | Synchronization Pitfalls | the queue, `settle()`, and a cascade budget | ◐ | Laufzeit |
| 4.8 | Security, Admin Permission | none | ✗ | Plattform |

## Compendium 104 — Configuration Admin

| § | Concept | tsm | | Art |
|---|---|---|---|---|
| 104.2 | Configuration Targets | PIDs | ✅ | |
| 104.3.1 | PID Syntax | any string; `demo.tiles` by convention | ✅ | |
| 104.3.2 | Targeted PIDs | `pid\|id\|version`, most specific first | ◐ | Plattform — `location` has no counterpart, a module has no install location |
| 104.4 | The Configuration Object | `pid`, `factoryPid`, `changeCount`, `getProperties`, `update`, `updateIfDifferent`, `delete` | ✅ | |
| 104.4.1 | Location Binding | none | ✗ | Plattform — it exists to stop a foreign bundle reading foreign configuration |
| 104.4.2 | Dynamic Binding | none | ✗ | Plattform |
| 104.4.3 | Configuration Properties | case-sensitive storage; two keys differing only in case are refused | ◐ | Sprache — OSGi's case-insensitive `Dictionary` has no JS equivalent; filters *are* case-insensitive, as in the spec |
| 104.4.4 | Property Propagation | not applicable | ✗ | Absicht — follows from 104.5: with no ManagedService there is nothing to propagate properties to |
| 104.4.5 | Automatic Properties | `service.pid`, `service.factoryPid` | ✅ | |
| 104.4.6 | Equality | undefined | ✗ | Sprache — no `equals` contract to honour |
| 104.5 | Managed Service | no whiteboard; the loader is the only recipient | ◐ | Absicht — DS is the modern route, and tsm has only that one |
| 104.6 | Managed Service Factory | factory configurations instantiate components instead | ◐ | Absicht — DS does the instance management, which is the point |
| 104.7 | Configuration Admin Service | `getConfiguration`, `getFactoryConfiguration`, `createFactoryConfiguration`, `listConfigurations`, `findConfiguration` | ✅ | `listConfigurations` returns `[]` rather than `null` — Absicht |
| 104.7.5 | Multi-Locations | none | ✗ | Plattform |
| 104.7.6 | Regions | none | ✗ | Plattform |
| 104.8 | Configuration Events | `ConfigurationListener` with `updated` / `deleted` | ◐ | Absicht — the event carries pid and factoryPid, not a reference back to the admin the listener already has; no Event Admin, see `SPEC.md` |
| 104.9 | Configuration Plugin | none | ✗ | Absicht — substitution belongs in the store |
| — | Persistence | `ConfigurationStore`; memory and `localStorage` included | ✅ | the spec requires persistence and leaves the medium open, which is exactly this seam |
| — | Asynchronous delivery | `update()` returns before components react; `settle()` waits | ✅ | |

## Compendium 105 — Metatype

| § | Concept | tsm | | Art |
|---|---|---|---|---|
| 105.2 | Attributes Model | `AttributeDefinition` | ✅ | |
| 105.3 | Object Class Definition | `objectClass({ id, name, description, attributes })` | ✅ | |
| 105.4 | Attribute Definition | `type`, `cardinality`, `default`, `options`, `required` (true by default, as in OSGi), `validate` | ◐ | Sprache — OSGi's eight numeric types collapse to `number` and `integer`; `CHARACTER`, `BYTE`, `SHORT`, `LONG`, `FLOAT` have no JS meaning |
| 105.4 | min / max | `min`/`max` for numbers, `minLength`/`maxLength` for text | ◐ | Absicht — OSGi compares min/max lexically for strings, which is of little use |
| 105.5 | Meta Type Service | `MetatypeRegistry`, published as `tsm.metatype` | ◐ | Modell — per application, not per bundle |
| 105.6 | Meta Type Provider Service | no whiteboard | ◐ | Absicht — the loader collects what components declare |
| 105.7 | Meta Type Resources | no `METATYPE.XML` | ✗ | Absicht — the schema is a value in code |
| 105.8 | XML Schema | none | ✗ | Absicht — JSON Schema and Ecore are the interchange formats instead (`toJsonSchema`, `@emfts/tsm-metatype`) |
| 105.9 | Meta Type Annotations | `objectClass()` instead of `@ObjectClassDefinition` on an interface | ◐ | Sprache — and it comes out better: `ConfigurationOf<typeof schema>` derives the type from the schema, where Java needs an interface *and* annotations that can drift apart |
| 105.12 | Capabilities | `osgi.extender=osgi.metatype` on the system bundle, offered only when the application supplied a registry | ✅ | a module with a `configurationSchema` can require it and stays unresolved where nothing would read it |
| — | Validation | `validate`, `coerce`; the admin refuses a bad `update()` | ◐ | Absicht — in OSGi neither CM nor Metatype validates; here it is opt-in and refuses at the source |
| — | Localization | `%key` per locale, an untranslated key keeps its `%key` form | ✅ | mechanism as in the spec, table instead of properties files |

## Core 3.3 — Requirements and Capabilities

| § | Concept | tsm | | Art |
|---|---|---|---|---|
| 3.3 | The dependency model — namespace, capability, requirement | `Capability`, `Requirement`, `resolveWiring()` | ✅ | |
| 3.3.3 | Bundle Capabilities | `capabilities` in the manifest, plus derived ones for identity and provided services | ✅ | |
| 3.3.4 | Capability Attributes, typed | `string`, `number`, `boolean`, arrays; `version` compared as a version | ◐ | Sprache — OSGi types attributes in the header (`version:Version=…`); here the type follows from the value, and `versionRange` does the version comparison |
| 3.3.6 | Bundle Requirements | `requirements`, with `filter`, `resolution`, `cardinality`, `effective` | ✅ | |
| 3.3.6 | `filter` matched per capability | one capability must satisfy the whole filter | ✅ | |
| 3.3.6 | Case sensitive attribute names | `createServiceFilter(expr, { caseSensitive: true })` | ✅ | the distinction from service properties is kept |
| 3.3.6 | Version constraints in the filter | `versionRange`, a semver range beside the filter | ◐ | Absicht — a filter compares text, so `(version>=1.9.0)` would accept `1.10.0` only by accident |
| 3.3.5 | System Bundle Capabilities | `getSystemBundle()` — a manifest for the runtime, carrying the registered libraries and `systemCapabilities` | ✅ | including the `.extra` route for what a deployer adds; the specification's own screen example works verbatim |
| 4.2.2 | `system.packages.extra` — packages the environment exports | `sharedDependencies` wires to a `tsm.library` capability the host offers | ◐ | Plattform — the same construction (the specification has the framework "export the JRE packages as system packages"), with a library where OSGi has a Java package |
| 3.2.5/3.2.6 | Version, Version Ranges | semver instead of OSGi's four-part version | ◐ | Sprache — the ecosystem's convention, and `semver` is already a dependency |
| 3.4 | Execution Environment (`osgi.ee`) | none | ✗ | Plattform — no JVM profile to assert |
| 3.7.10 | Provider Selection | highest `version` attribute wins, declaration order breaks a tie | ◐ | Absicht — a full constraint solver addresses problems that only package wiring creates |
| — | Resolution timing | static, over manifests, before loading; `getUnresolvedModules()` reports what waits *in vain* | ✅ | the line the specification draws at Compendium 135.4: a service capability is a promise |
| 3.6.4 | `Import-Package` — a library needed from elsewhere | `sharedDependencies`, expressed as a `tsm.library` requirement | ◐ | Plattform — the intent is the same, the mechanism is not: OSGi wires the import to an exporter and the class loader *enforces* one instance, while tsm checks that the host registered one and relies on there being a single registry. Hence no second version at a time, and hence the build check: where OSGi has a verifier, a bundled copy here would just behave subtly wrong |
| 135.2-135.6 | Registered namespaces (`osgi.extender`, `osgi.contract`, `osgi.implementation`, …) | `osgi.identity`, `osgi.service`, `osgi.extender` (component, metatype) and `osgi.implementation` (`osgi.cm`); a shared library uses `tsm.library` | ◐ | Absicht — only `osgi.contract` is left out: it is for specification contracts with discrete versioning, and no registered namespace means "the host supplies this library instance", which is what `tsm.library` says |

## Compendium 112 — Declarative Services

| § | Concept | tsm | | Art |
|---|---|---|---|---|
| 112.2.1 | Declaring a Component | `@component()` | ✅ | |
| 112.2.2 | Immediate Component | `immediate`, default when `@activate` exists | ✅ | |
| 112.2.3 | Delayed Component | default without `@activate` | ✅ | |
| 112.2.4 | Factory Component (`factory=`) | `@component({ factory })` registers a `ComponentFactory` | ✅ | distinct from factory *configurations*: data creates those, a call creates these |
| 112.3.1 | Accessing Services | `@inject` | ✅ | |
| 112.3.2 | Method Injection (bind/unbind per reference) | `@bind()` / `@unbind()`, called before `@activate` and in declaration order | ✅ | the decorator names the method by sitting on it, where DS names it in XML |
| 112.3.3 | Field Injection | `@inject` on a property | ✅ | |
| 112.3.4 | Constructor Injection | `@inject` on a parameter | ✅ | |
| 112.3.5 | Reference Cardinality | `0..1`, `1..1`, `0..n`, `1..n` | ✅ | |
| 112.3.6 | Reference Scope | none | ✗ | Absicht — the provider decides whether its service is shareable, not the consumer; see `SPEC.md` §11.4b |
| 112.3.7 | Reference Policy | `static` / `dynamic`, per component reference through `@bind`/`@unbind` and per module requirement through `policy` | ◐ | Sprache — a reference is dynamic because the methods are there, not because an attribute says so; no `policy=` to contradict the code |
| 112.3.8 | Reference Policy Option | `greedy` / `reluctant` | ✅ | |
| 112.3.9 | Reference Field Option | `@injectAll(id, { fieldOption })` | ✅ | `update` keeps the array's identity, which is what a reactive view bound to it needs |
| 112.3.10 | Selecting Target Services | `target` filter, LDAP syntax | ✅ | overriding it by configuration is missing — Modell, see `SPEC.md` §11.3 |
| 112.3.11 | Circular References | detected while resolving; the chain is refused | ◐ | Modell — OSGi permits a cycle broken by a dynamic optional reference; tsm refuses the chain rather than deciding which reference may break it |
| 112.3.12 | Logger Support | `ComponentContext.log`, named after the component | ◐ | Sprache — a logger per component, not a `Logger` service to inject; the factory instance's PID is part of the name |
| 112.3.13 | Satisfying Condition | `satisfyingCondition` filter over `tsm.condition` services | ✅ | treated as one more mandatory reference, as DS models it; `condition.id=true` is always registered |
| 112.4 | Component Description (XML) | decorator metadata at runtime, read by the loader | ◐ | Sprache — `Symbol.for()` keys survive separate builds, so no descriptor generation step is needed |
| 112.4.2 | Service Component Header | none needed | ◐ | Sprache |
| 112.5.1 | Enabled | `disableComponent` / `enableComponent`, beside the module's switch | ✅ | a dimension of its own at both levels: off is not waiting |
| 112.5.2 | Satisfied | per component for both: a missing `@inject()` service leaves it `unsatisfied-reference`, a missing PID `unsatisfied-configuration`; the module keeps running either way | ✅ | the module-level `requiresService` stays as the coarser tool — it parks a whole module on purpose |
| 112.5.6 | Activation | `@activate`, two phases (register all, then activate) | ✅ | |
| 112.5.8 | Component Context | `ComponentContext` with `configuration`, `properties`, `configurationPid` | ✅ | |
| 112.5.9 | Activation Objects | the context object; no `Map` / property-type parameter forms | ◐ | Sprache — no overload resolution to pick a parameter shape by type |
| 112.5.12 | Bound Service Replacement | `policyOption: greedy` rebuilds or rebinds | ✅ | |
| 112.5.13-15 | Updated, Modification, Modified Method | `@modified()`; without it, rebuild | ✅ | |
| 112.5.16 | Deactivation | `@deactivate`, newest first | ✅ | |
| 112.5.18 | Unbinding | `@unbind()`; a mandatory reference going means the component goes, an optional one does not | ✅ | |
| 112.6.1 | Service Properties | component properties merged with configuration; keys starting with `.` stay private | ✅ | |
| 112.6.1 | `service.ranking` from configuration | overrides the declared ranking | ✅ | |
| 112.7.1 | Configuration Changes | `configurationPolicy: require / optional / ignore` | ✅ | |
| 112.8.2 | Component Property Types | `ConfigurationOf<typeof schema>` | ◐ | Sprache — one artefact instead of two |
| 112.9 | Service Component Runtime | `ServiceComponentRuntime` under `tsm.component.runtime`: descriptions, state, enable/disable | ◐ | Modell — the loader is framework and SCR in one object, so it cannot be stopped or swapped; introspection is a service all the same, so a component view can be a module |
| 112.9.4 | Locating Component Methods | decorators name them; no reflective search | ◐ | Sprache |
| 112.9.5 | Bundle Activator Interaction | a module's `activate` export and its components coexist, `activate` first | ✅ | |

## Not implemented at all

| Spec | | Why |
|---|---|---|
| **Core 3.5, 3.7, 3.9** — class loading, constraint solving, package wiring | ✗ | Plattform — ES modules resolve their own imports, so `Import-Package`, `uses` constraints, class space consistency, fragments and refresh have nothing to attach to |
| **Core 3.6** — Multiple versions | ✗ | One version per module ID at runtime. Plattform — ES modules give no isolation to hang a second version on |
| **Compendium 701** — Log Service, Event Admin, Http Whiteboard, … | ✗ | Out of scope: tsm is the module and service layer, not a service catalogue |


---

## Compendium 159 — Feature Service

A set of modules and their configuration as one deployable, versioned document.
The specification defines the document and the API to read it, and says
explicitly that installing one is a *launcher's* business — so the launcher below
is an addition, not a claim of conformance.

| § | Concept | tsm | | Art |
|---|---|---|---|---|
| 159.2 | Feature | `readFeature()`, immutable and frozen | ✅ | |
| 159.2.1 | Identifiers | `name@version`, `@scope/name@version` | ◐ | Modell — Maven coordinates have no counterpart; tsm modules are npm packages, and a group id would be a field nobody could fill in truthfully |
| 159.2.2.1 | Identifier type `osgifeature` | none | ✗ | Modell — follows from 159.2.1: there is no type segment to put it in |
| 159.2.3 | Attributes | `name`, `categories`, `complete`, `description`, `docURL`, `license`, `scm`, `vendor` | ✅ | |
| 159.2.4 | Feature API, builders | object literals, checked by the compiler | ◐ | Sprache — builders exist there because a `Feature` is an immutable Java object with a dozen fields; here the literal *is* the builder |
| 159.3 | Comments | `stripComments()`, JSMin style, string contents left alone | ✅ | |
| 159.4 | Bundles | `bundles[]` with ids resolved by the launcher | ✅ | |
| 159.4.1 | Bundle metadata | arbitrary keys, string/number/boolean, refused otherwise | ✅ | |
| 159.5 | Configurations | `configurations` by PID, factory PIDs as `factoryPid~name` | ◐ | Modell — Configuration Admin directly rather than through the Configurator (150), which tsm does not have; the typed key syntax is supported because variables need it |
| 159.6 | Variables | defaults, `null` for "must be supplied", `${...}` kept when unknown | ✅ | |
| 159.7 | Extensions | text, JSON and artifacts; mandatory/optional/transient | ✅ | a mandatory extension nobody handles refuses the install |
| 159.8 | Framework launching properties | none | ✗ | Plattform — there is no framework to launch with properties; a browser page is already running |
| 159.9 | Resource versioning | `feature-resource-version`, refused when unknown | ✅ | |
| 159.10 | Capabilities | `osgi.implementation=osgi.feature` on the system bundle | ✅ | |
| 159.11 | `org.osgi.service.feature` | `FeatureService` under `tsm.feature.service` | ◐ | Sprache — the same operations without the builder factory, see 159.2.4 |
| 159.12 | `org.osgi.service.feature.annotation` | none | ✗ | Sprache — the annotations name a Java package for a build-time processor |
| — | Installing a feature | `installFeature()`: validate, configure, register, load | ✅ | the specification leaves this to a launcher; configuration is written *before* loading, so a component requiring a PID sees it on its first activation |
| — | Completeness | `isComplete()`, `unsatisfiedRequirements()` against the live wiring | ✅ | `complete: true` is a claim by the author; this checks it, and counts what the runtime itself offers |

---

## What this adds up to

Counted over the 142 numbered rows above — the four closing rows summarise whole
chapters and are left out: **72 conform**, **50 present but different**,
**20 absent**. Every one of the 70 departures carries a reason, and the large
majority are **not choices**:

- **Sprache** (25 rows) — Java's `Dictionary`, checked exceptions, class names as
  service identity, overload resolution, reference counting, eight numeric types,
  and everything that follows from GC: no handle to release a service, no way to
  revoke a stale reference.
  Copying these would make tsm worse, not more conform. Two of them come out
  *better* in TypeScript: the schema that is also the type (105.9, 112.8.2), and
  decorator metadata that needs no descriptor generation (112.4).
- **Plattform** (18 rows) — everything that rests on a class loader, a file system,
  or a security boundary between bundles: lazy activation, persistent storage,
  permissions, location binding, multiple versions, and the `location` segment of
  a targeted PID.
- **Laufzeit** (2 rows) — `import()` is asynchronous, so reactions to events run in
  a queue rather than inside the event. This is why `settle()` exists and OSGi
  needs no equivalent.
- **Modell** (9 rows) — the loader is framework and SCR in one object, so SCR
  cannot be stopped or swapped; and identifiers are npm's rather than Maven's,
  which is most of what a feature departs in. What does *not* follow from the
  first any more: introspection is a service (112.9), the component layer is a
  capability a module can require (105.12, 135.4), and satisfaction, configuration
  and the service scope all work per component (112.5.2, 112.7.1, 5.3).
- **Absicht** (16 rows) — named and argued in `SPEC.md`: no whiteboard for
  ManagedService or MetaTypeProvider, no XML, no ConfigurationPlugin, validation at
  the source instead of in the UI, `[]` instead of `null`.

**No row is marked as a gap any more.** The seven that were are built: factory
components, `module` service scope, `MODIFIED_ENDMATCH`, the `update` field
option, satisfying conditions, a logger per component, and targeted PIDs. What is
still absent from the specifications is absent for a reason of language,
platform, model or intent — which is a different claim than "not yet done", and
the one this table exists to make.

Two of the seven turned out to say something about the design rather than just
fill a hole:

- A service's own references resolve on behalf of the module that **provides**
  it, not the one that asked. Whose code runs decides whose instance it gets —
  otherwise `module` scope leaks down the dependency chain and one singleton ends
  up with two different dependencies underneath it.
- Filtering belongs in `addListener`, not in the callback. A listener that tests
  properties itself can never learn that a service it had accepted stopped
  qualifying, so whatever it collected goes stale in silence. That is the whole
  content of `MODIFIED_ENDMATCH`.

**Compendium 159** is no longer open. A feature turned out to be the document that
answers "which modules, in which versions, with which configuration" — the
question that otherwise lives in host code, where it cannot be versioned or
reviewed. The specification stops at reading and writing; `installFeature()` is
the launcher it leaves to the implementation, and its one real decision is that
configuration is written *before* loading, so a component that requires a PID sees
it on its first activation instead of being reconfigured a moment later.

What is left absent across the whole table is what rests on a class loader, a file
system, a JVM profile, or a security boundary between bundles — and the Java
package names of annotations meant for a build-time processor.
