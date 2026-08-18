# Workbench Example

Seven bundles, each built on its own, discovered at runtime. Views come and go
while the shell keeps running.

```bash
npm run example:workbench:build   # build the bundles (once, or after a change)
npm run example:workbench         # http://localhost:5181
```

Then open the console and type `tsm.lb()`.

## Structure

```
bundles/
├── contracts.ts            service ids and their types, shared as types
├── clock/
│   ├── manifest.json       id, version, entry — no provides, see below
│   ├── vite.config.ts      builds this bundle alone
│   └── src/index.ts        @component classes
├── notes/  outline/  outline-pro/  search-box/  metrics/  shell/
dist-bundles/               build output: index.js + generated manifest.json
src/main.ts                 the host: discovers the repository, provides the regions
```

Each bundle is a deployment unit: its own manifest, its own build, loaded by URL.
The host knows no module by name except the clock, which a button loads on demand
— everything else it finds through `PluginRegistry` in `dist-bundles/index.json`.

**`provides` is not written by hand.** The build runs
`tsmPlugin({ components: 'derive' })`, which reads the `@component()`
declarations out of the sources and emits a manifest containing them:

```jsonc
// dist-bundles/metrics/manifest.json — generated
"provides": [
  { "id": "workbench.metrics" },
  { "id": "ui.component", "properties": { "region": "main", "order": 3 } }
]
```

So the declaration exists once, on the class, and the manifest that the resolver
and satisfaction need before importing anything is derived from it. This is what
bnd does for OSGi.

## What it shows

**A region collects, a slot competes.**

| | Declaration | Behaviour |
|---|---|---|
| Region | `properties: { region: 'main' }` | everything registered for it is mounted, ordered by `order` |
| Slot | `properties: { slot: 'outline' }` | several modules offer the same place; the highest `ranking` is shown |

`outline` and `outline-pro` share the `outline` slot. *Disable Outline Pro*
switches that bundle off and the plain outline takes over; enabling it brings it
back. Both registrations exist the whole time.

**Coming and going, with cleanup.** The clock holds an interval. `@deactivate`
clears it, which is the difference between a view that disappears and one that
leaks — `src/__tests__/example-workbench.test.ts` proves it by keeping the
detached element and advancing timers by five seconds.

**Components, not registration code.** A view declares what it offers and needs
nothing else:

```ts
@component({ service: [UI_COMPONENT], properties: { region: 'main', order: 1 } })
export class ClockView implements UiComponent {
  constructor(@inject(METRICS_SERVICE, { optional: true }) private metrics?: Metrics) {}

  mount(host: HTMLElement): void { this.timer = setInterval(…) }
  unmount(): void { clearInterval(this.timer) }
}
```

A component with `@activate` is created when its bundle activates (*immediate* in
DS terms); without one, on first resolution (*delayed*). The clock deliberately
has neither: a view has nothing to do until it is shown, so its interval belongs
to `mount` — in `@activate` it would tick against nothing. `tsm.providers('ui.component')`
shows the consequence: the outline hidden by Outline Pro reports
`instantiated: false`, because nobody ever resolved it.

`metrics` is the counter-example. Its view records that it exists, which is worth
doing unshown, so it declares `@activate` and `@deactivate`. That bundle also
holds two components — one service, one view — which is why registration and
activation happen in separate phases: the view injects the service its neighbour
offers.

**No bundle depends on the shell.** A view registers a service and does not know
who collects it; the shell asks for `0..n`, meaning none or many. A dependency the
other way round would make a provider need its consumer, and the clock would stop
being usable without a workbench.

**The shell survives all of it.** It is the one bundle that is not a component
but a module with exported hooks, because notifications about a *changing set*
(`onServiceBound`/`onServiceUnbound`) are module-level today. It declares

```ts
{ id: 'ui.component', cardinality: '0..n', policy: 'dynamic' }
```

and reconciles the DOM against the registrations, diffing by registration key.

## Try in the console

```js
tsm.lb()                                            // every bundle with its state
tsm.providers('ui.component')                       // every contribution, best first
tsm.providers('ui.component', '(region=sidebar)')   // just the sidebar
tsm.consumers('ui.component')                       // the shell, and how it asks
tsm.disable('search-box')                           // watch the toolbar empty out
tsm.unsatisfied()                                   // what is waiting, and for what
```

## Notes on the setup

The bundles are served by a small static middleware in `vite.config.ts` rather
than from `public/`: Vite refuses dynamic imports from there, since a finished
artefact must not go through its transform pipeline. In production a web server
hands these files over.

Each bundle currently carries its own copy of `reflect-metadata` (~39 kB), which
is why the decorator metadata keys use `Symbol.for()` — otherwise a separately
built copy would write under a key the host cannot read. A real deployment would
provide it once as a shared library, as `examples/shared-libraries` shows.
