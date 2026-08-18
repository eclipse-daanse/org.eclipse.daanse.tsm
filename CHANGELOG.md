# Changelog

All notable changes to the `@eclipse-daanse/tsm` package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Groundwork for [#18](https://github.com/eclipse-daanse/org.eclipse.daanse.tms/issues/18): services now
have an owner and withdrawals are observable. Reacting to a withdrawal — the `unsatisfied` state and the
`static`/`dynamic` policies — is deliberately not part of this change.

### Fixed

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

### Changed

- Rebinding a primary ID via `register()`, `bind()` or `bindClass()` now discards the alias bindings of the
  registration it replaces. The alternative — pointing the alias at the new provider — would assign
  interfaces the new provider never declared.
- `ModuleEvent.type` has an additional value (`'service-withdrawn'`), which affects consumers that handle the
  union exhaustively in a `switch`.
