# Configuration

Configuration belongs to the **component**, not to the bundle.

```bash
npm run example:config      # http://localhost:5183
```

Set a value and watch what it decides: whether a component runs at all, how many
instances of it exist, and what its services publish. The bundles stay active the
whole time — that separation is the point.

## The three cards

**`demo.tiles` · policy `require`** — `RasterTiles` is not registered until this
PID exists. Note what that does to the bundle list: `tiles` is *active*, while
`map` is *unsatisfied* and waits for `demo.tiles`. A missing service parks a whole
module; a missing configuration holds back one component and leaves its bundle
running. Save a url and the map bundle comes up with it.

**`demo.clock` · two components on one PID** — `SteadyClock` has a `@modified()`
method, `RestartingClock` does not. Change the interval and compare the tick
counts: the steady clock keeps counting because its instance survived, the other
starts at zero because it is a different object. That is the entire difference
`@modified()` makes, and it is why you write one when a rebuild would cost
something — an open connection, a mounted view, accumulated state.

**`demo.tile-source` · a factory PID** — the same class, one instance per
configuration, each with its own properties and its own registration of
`demo.tiles`. Add two sources and both show up as providers, distinguishable by
`(name=satellite)`. In DS this is not a separate feature either: it follows from
the PID naming a factory.

## The schemas

Each of these PIDs is described by an `objectClass()` in
[`src/contracts.ts`](src/contracts.ts), and the description is the TypeScript type
as well — `ConfigurationOf<typeof TileSchema>`. Two things follow from that, both
visible here:

- The clocks read `context.configuration.interval` with no `?? 1000` anywhere,
  because the schema declares the default and the loader applies it.
- Saving a url shorter than eight characters, or a zoom above 22, is refused
  before it reaches a component — the message appears in the lifecycle panel.

`tsm.describe('demo.tiles')` in the console prints the attributes with their
types, ranges and current values. And `toMetamodelSchema(metatype)` turns all of
them into JSON Schema, which `@emfts/codec.jsonschema` converts into an EMF
EPackage — that is the path to a generated form, and the reason this page has
hand-written fields instead of a form generator of its own.

## Reload the page

The values are still there. `LocalStorageConfigurationStore` writes one entry per
PID, and `loadAll()` awaits `ConfigurationAdmin.ready()` — so a component whose
values are already stored starts with them instead of being parked and woken a
moment later. Persistence is the part the OSGi specification requires while
leaving the medium to the implementation, which is exactly what a
`ConfigurationStore` is.

## In the console

```js
tsm.components()                              // declarations and their state
tsm.config()                                  // configurations, and who reads them
tsm.configure('demo.tiles', { url: '…' })     // set values, wait for the reaction
tsm.unconfigure('demo.tiles')                 // delete them again
tsm.providers('demo.tiles')                   // every provider, best first
```

## What the host does

```ts
const configuration = new ConfigurationAdmin({
  store: new LocalStorageConfigurationStore('tsm.example.config.')
})
const loader = new ModuleLoader({ serviceRegistry: services, configurationAdmin: configuration })
```

That is the whole wiring. From there the PIDs decide, and the admin is available
to the modules themselves as `tsm.configuration.admin`.

`src/__tests__/example-config.test.ts` asserts the behaviour this page shows:
the parked component with its bundle still active, the cascade into `map`, the
tick-count difference between the two clocks, and two instances from one class.
