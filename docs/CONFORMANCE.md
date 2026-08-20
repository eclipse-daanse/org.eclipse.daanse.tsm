# Conformance to the OSGi specifications

What tsm implements of OSGi Release 8, section by section, and where it departs —
with the reason, because the reasons are not all of one kind. Fetch the
specifications with `npm run docs:osgi` to read along; the section numbers are
theirs.

Scope: **Core 4** (Life Cycle Layer), **Core 5** (Service Layer, incl. 5.8
Filters), **Compendium 104** (Configuration Admin), **105** (Metatype) and **112**
(Declarative Services). Core 3 (Module Layer) and 159 (Feature Service) have no
counterpart in tsm at all and are listed at the end as such.

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
| **Modell** | follows from tsm settling satisfaction per *module* where DS settles it per *component* |
| **Absicht** | deliberately left out or done differently; the reason is in `SPEC.md` |
| **Lücke** | missing without a reason of principle — buildable |

---

## Core 5 — Service Layer

| § | Concept | tsm | | Art |
|---|---|---|---|---|
| 5.2.1 | Service References | `ServiceReference` with `key`, `properties`, `ranking`, `instantiated` | ✅ | |
| 5.2.2 | Service Interfaces | String IDs instead of class names | ◐ | Sprache — a TS interface does not exist at runtime, so there is nothing to name a service by |
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
| 5.3 | Service Scope | `singleton` and `transient` | ◐ | **Lücke** — OSGi also has `bundle` scope, and tsm does know its consumer (the module), so this could be built |
| 5.4.1 | Getting a Single Service Object | `get(id)` | ✅ | |
| 5.4.2 | Getting Multiple Service Objects | no `ServiceObjects` | ✗ | follows from the missing prototype scope |
| 5.5 | Releasing Service Objects | nothing to release | ◐ | Sprache — reference counting exists because Java has no GC boundary here; the cost is that a transient service is never told it is done with |
| 5.6.1 | Service Event Types | `registered`, `updated`, `unregistered` | ◐ | **Lücke** — `MODIFIED_ENDMATCH` is missing, because tsm has no filter-based listening |
| 5.7 | Stale References | `invalidateInjectors` discards singletons built with a service that changed | ◐ | mitigated, not guaranteed — a module holding a reference itself keeps it |
| 5.8 | Filters | `serviceFilter.ts`, checked against Felix `FilterImpl` and its TCK | ✅ | |
| 5.9 | Service Factory | `bind(id, factory)` — but without the consuming bundle as an argument | ◐ | follows from 5.3 |
| 5.10 | Prototype Service Factory | `transient` gives a new instance per resolution | ◐ | close in effect, not in contract |
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
| 4.4.9 | Updating Bundles | `reloadModule`, with dependents | ◐ | no version negotiation on update |
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
| 104.3.2 | Targeted PIDs | none | ✗ | Plattform — `pid\|bsn\|version\|location` needs bundle identity and version |
| 104.4 | The Configuration Object | `pid`, `factoryPid`, `changeCount`, `getProperties`, `update`, `updateIfDifferent`, `delete` | ✅ | |
| 104.4.1 | Location Binding | none | ✗ | Plattform — it exists to stop a foreign bundle reading foreign configuration |
| 104.4.2 | Dynamic Binding | none | ✗ | Plattform |
| 104.4.3 | Configuration Properties | case-sensitive storage; two keys differing only in case are refused | ◐ | Sprache — OSGi's case-insensitive `Dictionary` has no JS equivalent; filters *are* case-insensitive, as in the spec |
| 104.4.4 | Property Propagation | not applicable | ✗ | follows from 104.5 |
| 104.4.5 | Automatic Properties | `service.pid`, `service.factoryPid` | ✅ | |
| 104.4.6 | Equality | undefined | ✗ | Sprache — no `equals` contract to honour |
| 104.5 | Managed Service | no whiteboard; the loader is the only recipient | ◐ | Absicht — DS is the modern route, and tsm has only that one |
| 104.6 | Managed Service Factory | factory configurations instantiate components instead | ◐ | Absicht — DS does the instance management, which is the point |
| 104.7 | Configuration Admin Service | `getConfiguration`, `getFactoryConfiguration`, `createFactoryConfiguration`, `listConfigurations`, `findConfiguration` | ✅ | `listConfigurations` returns `[]` rather than `null` — Absicht |
| 104.7.5 | Multi-Locations | none | ✗ | Plattform |
| 104.7.6 | Regions | none | ✗ | Plattform |
| 104.8 | Configuration Events | `ConfigurationListener` with `updated` / `deleted` | ◐ | no `ConfigurationEvent` object carrying a reference to the admin; no Event Admin |
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
| 105.12 | Capabilities | none | ✗ | Modell — tsm has no requirements/capabilities model |
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
| 135.2-135.6 | Registered namespaces (`osgi.extender`, `osgi.contract`, `osgi.implementation`, …) | only `osgi.identity` and `osgi.service` are used; a shared library uses `tsm.library` | ◐ | Absicht — none of the registered namespaces means "the host supplies this library instance": `osgi.contract` is for specification contracts with discrete versioning. Core 3.3 provides for own namespaces, which makes this the conform way to say something the specification has no name for |

## Compendium 112 — Declarative Services

| § | Concept | tsm | | Art |
|---|---|---|---|---|
| 112.2.1 | Declaring a Component | `@component()` | ✅ | |
| 112.2.2 | Immediate Component | `immediate`, default when `@activate` exists | ✅ | |
| 112.2.3 | Delayed Component | default without `@activate` | ✅ | |
| 112.2.4 | Factory Component (`factory=`) | none | ✗ | **Lücke** — not to be confused with factory *configurations*, which tsm has |
| 112.3.1 | Accessing Services | `@inject` | ✅ | |
| 112.3.2 | Method Injection (bind/unbind per reference) | module-wide `onServiceBound` / `onServiceUnbound` | ◐ | **Lücke** — per-reference hooks on the component are missing |
| 112.3.3 | Field Injection | `@inject` on a property | ✅ | |
| 112.3.4 | Constructor Injection | `@inject` on a parameter | ✅ | |
| 112.3.5 | Reference Cardinality | `0..1`, `1..1`, `0..n`, `1..n` | ✅ | |
| 112.3.6 | Reference Scope | none | ✗ | follows from 5.3 |
| 112.3.7 | Reference Policy | `static` / `dynamic` | ◐ | Modell — declared per requirement of a *module*, not per reference of a component |
| 112.3.8 | Reference Policy Option | `greedy` / `reluctant` | ✅ | |
| 112.3.9 | Reference Field Option | none | ✗ | **Lücke** — `replace` vs. `update` for collections |
| 112.3.10 | Selecting Target Services | `target` filter, LDAP syntax | ✅ | overriding it by configuration is missing — Modell, see `SPEC.md` §11.3 |
| 112.3.11 | Circular References | detected while resolving; the chain is refused | ◐ | OSGi permits a cycle through a dynamic optional reference; tsm does not distinguish |
| 112.3.12 | Logger Support | none | ✗ | small Lücke — `ModuleContext.log` exists, but is not injectable per component |
| 112.3.13 | Satisfying Condition | none | ✗ | **Lücke** — DS 1.5's `osgi.ds.satisfying.condition`, resting on the Condition Service of Core R8 |
| 112.4 | Component Description (XML) | decorator metadata at runtime, read by the loader | ◐ | Sprache — `Symbol.for()` keys survive separate builds, so no descriptor generation step is needed |
| 112.4.2 | Service Component Header | none needed | ◐ | Sprache |
| 112.5.1 | Enabled | `disableModule` / `enableModule` | ◐ | Modell — DS enables and disables individual components |
| 112.5.2 | Satisfied | per module for services; **per component for configuration** | ◐ | Modell — the central departure. A missing service parks the whole module; a missing PID holds back one component |
| 112.5.6 | Activation | `@activate`, two phases (register all, then activate) | ✅ | |
| 112.5.8 | Component Context | `ComponentContext` with `configuration`, `properties`, `configurationPid` | ✅ | |
| 112.5.9 | Activation Objects | the context object; no `Map` / property-type parameter forms | ◐ | Sprache — no overload resolution to pick a parameter shape by type |
| 112.5.12 | Bound Service Replacement | `policyOption: greedy` rebuilds or rebinds | ✅ | |
| 112.5.13-15 | Updated, Modification, Modified Method | `@modified()`; without it, rebuild | ✅ | |
| 112.5.16 | Deactivation | `@deactivate`, newest first | ✅ | |
| 112.6.1 | Service Properties | component properties merged with configuration; keys starting with `.` stay private | ✅ | |
| 112.6.1 | `service.ranking` from configuration | overrides the declared ranking | ✅ | |
| 112.7.1 | Configuration Changes | `configurationPolicy: require / optional / ignore` | ✅ | |
| 112.8.2 | Component Property Types | `ConfigurationOf<typeof schema>` | ◐ | Sprache — one artefact instead of two |
| 112.9 | Service Component Runtime | the loader is framework and SCR in one object | ◐ | Modell — which is why 112.5.2 reads as it does |
| 112.9.4 | Locating Component Methods | decorators name them; no reflective search | ◐ | Sprache |
| 112.9.5 | Bundle Activator Interaction | a module's `activate` export and its components coexist, `activate` first | ✅ | |

## Not implemented at all

| Spec | | Why |
|---|---|---|
| **Core 3.5, 3.7, 3.9** — class loading, constraint solving, package wiring | ✗ | Plattform — ES modules resolve their own imports, so `Import-Package`, `uses` constraints, class space consistency, fragments and refresh have nothing to attach to |
| **Core 3.6** — Multiple versions | ✗ | One version per module ID at runtime. Plattform — ES modules give no isolation to hang a second version on |
| **Compendium 159** — Feature Service | ✗ | Nothing yet; this is the open question of what a feature would mean here |
| **Compendium 701** — Log Service, Event Admin, Http Whiteboard, … | ✗ | Out of scope: tsm is the module and service layer, not a service catalogue |

---

## What this adds up to

Counted over the 123 rows above: **51 conform**, **48 present but different**,
**24 absent**. Of the 72 departures, the large majority are **not choices**:

- **Sprache** (17 rows) — Java's `Dictionary`, checked exceptions, class names as
  service identity, overload resolution, reference counting, eight numeric types.
  Copying these would make tsm worse, not more conform. Two of them come out
  *better* in TypeScript: the schema that is also the type (105.9, 112.8.2), and
  decorator metadata that needs no descriptor generation (112.4).
- **Plattform** (15 rows) — everything that rests on a class loader, a file system,
  or a security boundary between bundles: lazy activation, persistent storage,
  permissions, location binding, targeted PIDs, multiple versions.
- **Laufzeit** (2 rows) — `import()` is asynchronous, so reactions to events run in
  a queue rather than inside the event. This is why `settle()` exists and OSGi
  needs no equivalent.
- **Modell** (10 rows) — tsm settles satisfaction per module where DS settles it
  per component, and the loader is framework and SCR in one. Configuration already
  works per component (112.7.1); services do not.

Core 3.3 — the generic requirement/capability model — is implemented as of the
section above; what remains absent from Core 3 is everything resting on a class
loader.
- **Absicht** (15 rows) — named and argued in `SPEC.md`: no whiteboard for
  ManagedService or MetaTypeProvider, no XML, no ConfigurationPlugin, validation at
  the source instead of in the UI, `[]` instead of `null`.

That leaves **7 rows marked as real gaps** — missing without a reason of
principle, and buildable, plus the one below that follows from them:

| | § | What it would take |
|---|---|---|
| Per-reference bind/unbind on a component | 112.3.2 | Component-level satisfaction, i.e. the same step as 112.5.2 |
| Component-level enable/disable and satisfaction | 112.5.1, 112.5.2 | The separation OSGi has between framework and SCR |
| Factory components | 112.2.4 | A `ComponentFactory` service per declaration |
| `bundle` service scope | 5.3 | tsm knows the consuming module, so the instance could be cached per module |
| `MODIFIED_ENDMATCH` | 5.6.1 | Filter-based listening in the registry |
| Reference field option `update` | 112.3.9 | Mutating a collection in place instead of replacing it |
| Satisfying condition | 112.3.13 | An `osgi.condition`-style service as a requirement |
| Targeted PIDs | 104.3.2 | Module identity and version in the PID lookup |

Ordered by what they would buy: the first two are one piece of work and the
largest one — everything else on the list is small in comparison, and several of
the small ones follow from it.
