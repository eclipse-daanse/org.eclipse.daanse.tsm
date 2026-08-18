# Bundles, Components, Services

The three layers, drawn from the running loader.

```bash
npm run example:graph      # http://localhost:5182
```

Nothing in the picture is hard-coded. Every box and every line comes from the
loader: `getManifests()` and `getComponents()` for the top two rows,
`getServiceReferences()` and `getServiceConsumers()` for the third and the edges.
Press the buttons and the drawing follows.

## Reading it

| | |
|---|---|
| Blue box | **Bundle** — a module with a manifest. Dashed and orange while it waits, faded when disabled |
| Green box | **Component** — a `@component()` class inside a bundle. Dashed outline means *delayed*: not constructed until somebody resolves it |
| Yellow box | **Service** — an ID. Red and dashed when nobody provides it |
| Green line | **provides** — a component registered under that service. Grey and dashed when the registration is standing by behind a higher-ranked one |
| Blue dashed line | **requires** — a bundle declared `requiresService` on it. Faint when optional |

## What the six bundles show

- **tiles** — one bundle, one component, one service: the simplest shape.
- **tiles-vector** *(button)* — a second provider for `demo.tiles`, ranked higher.
  Watch `demo.tiles` change to "2 providers" and the raster tiles' line turn grey:
  the registration stays, it just stopped being the visible one.
- **navigation** — two components in one bundle. `ShortestPath` offers a service;
  `TrafficWatcher` offers none and only has a lifecycle, which is why it is drawn
  as `immediate · no service`. It also injects the service its neighbour offers,
  which is why the loader registers every component before activating any.
- **traffic** *(button)* — fills `TrafficWatcher`'s *optional* dependency. Nothing
  restarts; the box simply gains a provider.
- **map** — a consumer that is itself a service. *Disable navigation* and watch the
  cascade: `demo.routing` loses its provider, so `map` starts waiting too.
- **elevation** — requires `demo.terrain`, which nobody provides. It stays parked,
  and it has **no components**: the classes are loaded but were never registered,
  because the bundle never activated.

## Why the host builds its own registry

```ts
const services = new DefaultServiceRegistry()
const loader = new ModuleLoader({ serviceRegistry: services })
```

Listening for service events needs `ObservableServiceRegistry`, while
`loader.getServiceRegistry()` returns the plain `ServiceRegistry` — a custom
registry need not be observable. Creating it here keeps the type.

## In the console

```js
tsm.lb()                        // bundles with their state
tsm.providers('demo.tiles')     // both providers, best first
tsm.consumers('demo.routing')   // who asked for it, and how
tsm.unsatisfied()               // elevation, and what it waits for
```

`src/__tests__/example-graph.test.ts` asserts the model *and* the drawing: box
counts, the parked bundle, the service without a provider, and the muted edge of a
standing-by registration.
