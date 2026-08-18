# Whiteboard Example

Six modules that find each other through services, plus one that deliberately
never runs. No framework, no separate `npm install` — it runs against the
package sources, so it moves with the code.

```bash
npm run example:whiteboard      # http://localhost:5180
```

Then open the browser console and type `tsm.help()`.

## What it shows

**Load order comes from the manifests.** `src/manifests.ts` registers consumers
first and providers last, on purpose. The palette and the greeting still come up:
a module whose services are missing is parked, not failed, and activates when
they appear.

**A collection nobody maintains.** The palette declares

```ts
{ id: 'demo.widget', cardinality: '0..n', policy: 'dynamic' }
```

and reads `getServiceReferences('demo.widget')`. Two widgets register under that
one ID with different `properties.kind`. There is no widget registry in this
example — the service registry is the collection.

**A set that changes while the consumer runs.** *Load the late widget* loads a
module after startup. Because the requirement is `dynamic`, the palette is
notified through `onServiceBound` and redraws; it is never torn down. *Unload the
table widget* is the same in reverse.

**Default and override by ranking.** `greeting-basic` and `greeting-premium`
provide the same service ID; premium declares `ranking: 10` in its manifest, so
that is what consumers see. *Disable premium greeting* switches the module off —
the basic greeting takes over, and the display follows because `greeter` declares
`policyOption: 'greedy'`. Enable it again and premium returns.

**Diagnosis.** `never-satisfied` requires a service nobody provides. It shows up
in the module table as `unsatisfied` and `tsm.unsatisfied()` names what it waits
for. Worth trying in the console:

```js
tsm.modules()                    // every module with its state
tsm.unsatisfied()                // what is waiting, and for what
tsm.providers('demo.widget')     // every registration, best first
tsm.providers('demo.greeting')   // premium first, basic standing by
tsm.consumers('demo.widget')     // who asked for it
tsm.disable('chart-widget')      // watch the palette lose an entry
```

## Files

| Path | Role |
|------|------|
| `src/main.ts` | Host: loader, the UI as a service, the buttons, devtools |
| `src/manifests.ts` | What each module needs and offers |
| `src/contracts.ts` | Service IDs and their types, shared as types only |
| `modules/*.ts` | The modules — none of them imports another |

## A trap worth knowing

Element ids and module ids share a namespace: a browser exposes every `id` as a
global, and TSM keeps module containers on `window` for Module Federation. An
`<ul id="palette">` next to a module called `palette` therefore collides — which
is exactly how this example was written first. The loader now checks whether the
global it found can be a container at all and warns instead of activating a
module that never ran; the ids here are kept distinct anyway.

## Note on the setup

The modules are loaded by URL (`entry: '/modules/palette.ts'`) and the dev server
transforms them on the fly, which keeps the example free of a build step. For a
production build each module would be built separately, as
`examples/shared-libraries` shows.

`src/__tests__/example-whiteboard.test.ts` runs this example without a browser:
it puts the real module code where `loadEntry()` looks and asserts the behaviour
described above.
