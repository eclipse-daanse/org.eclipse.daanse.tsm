# Workbench Example

A shell with three regions, into which modules contribute views — and out of
which the views disappear again while the shell keeps running.

```bash
npm run example:workbench      # http://localhost:5181
```

Watch the activity log while you press the buttons. *Start churn* loads and
unloads the clock every 2.5 seconds, which is the whole point of the example:
components arrive and leave, and nothing else restarts.

## What it shows

**A region collects, a slot competes.** Both are needed in a workbench, and they
are different mechanisms:

| | Declaration | Behaviour |
|---|---|---|
| Region | `properties: { region: 'main' }` | everything registered for it is mounted, ordered by `order` |
| Slot | `properties: { slot: 'outline' }` | several modules offer the same place; the highest `ranking` is shown |

`outline` and `outline-pro` share the `outline` slot. *Disable Outline Pro*
switches its module off, the plain outline appears in its place, and enabling it
brings it back. Both registrations exist the whole time — the shell decides which
one is visible, using `reference.ranking`.

**Coming and going, with cleanup.** The clock holds an interval. Its `unmount()`
clears it, which is the difference between a view that disappears and a view that
leaks. `src/__tests__/example-workbench.test.ts` proves it: it keeps a reference
to the detached counter element, advances the clock by five seconds, and asserts
that nothing wrote into it any more.

**The shell survives all of it.** It declares

```ts
{ id: 'ui.component', cardinality: '0..n', policy: 'dynamic' }
```

so it is notified instead of being torn down. Its `sync()` diffs by registration
key — the hook says *that* the set changed, not which entry, so the shell does
the same bookkeeping a keyed list in any UI framework does.

**Placement belongs to the manifest.** A module registers its component and says
nothing about where it goes; region, order and slot are declared in
`src/manifests.ts`. That is deployment information, and the same component can be
placed differently without touching its code. Properties declared in a manifest
and properties passed at registration are merged per key, so a module can add
what only it knows.

**Every view is a decorated class.** They are registered with `bindClass()`, so
the registry constructs them and injects what they declare:

```ts
@injectable()
class ClockView implements UiComponent {
  // Optional: the clock reports to the metrics service when it exists and works
  // without it when it does not. No requirement in the manifest — optionality is
  // decided at the injection point.
  constructor(@inject(METRICS_SERVICE, { optional: true }) private metrics?: Metrics) {}
}
```

```ts
// Registered under the interface directly: a view needs no id of its own
context.services.bindClass(UI_COMPONENT, ClockView)
```

`modules/metrics.ts` is the one module that also offers a service of its own, so
it is the one that needs `implements`:

```ts
context.services.bindClass(METRICS_SERVICE, WorkbenchMetrics)
context.services.bindClass('workbench.metrics-view', MetricsView, {
  implements: [UI_COMPONENT]
})
```

Its manifest declares properties for *both* ids, because the interface is what
the shell filters on, not the class.

Three things worth knowing:

- `@inject` names the service id explicitly, so no type reflection is involved.
  `experimentalDecorators` suffices and esbuild's missing `emitDecoratorMetadata`
  does not matter — decorators need no extra setup under Vite.
- `bindClass` is lazy. Nothing is constructed until the shell resolves the
  reference, which the test checks via `reference.instantiated`.
- `@inject(id, { optional: true })` is not the same as an optional
  `requiresService`: the manifest decides whether the *module* may activate, the
  injection point decides whether that one dependency may be absent.

## Try in the console

```js
tsm.providers('ui.component')                       // every contribution, best first
tsm.providers('ui.component', '(region=sidebar)')   // just the sidebar
tsm.consumers('ui.component')                       // the shell, and how it asks
tsm.disable('search-box')                           // watch the toolbar empty out
tsm.lb()                                            // modules, including disabled ones
```

## Files

| Path | Role |
|------|------|
| `src/main.ts` | Host: the regions as a service, the buttons, the churn timer |
| `src/manifests.ts` | Placement of each view: region, order, slot, ranking |
| `src/contracts.ts` | `UiComponent` with `mount`/`unmount`, and the region contract |
| `modules/shell.ts` | Mounts, orders and unmounts; the only module that consumes |
| `modules/*.ts` | The views. None of them knows about another |
