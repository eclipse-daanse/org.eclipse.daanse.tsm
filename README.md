# TSM — TypeScript Module System

A module and service layer for TypeScript applications: separately built bundles that find each other at
runtime through services rather than imports, with a lifecycle, configuration, and a resolution that can say
what will run before anything loads.

The model is OSGi's, translated rather than copied — `docs/CONFORMANCE.md` compares it section by section
against Release 8 and gives a reason for every departure.

```bash
npm install @eclipse-daanse/tsm
```

## The shortest thing that works

A host that loads one module, and a module that provides one service. Neither imports the other.

```typescript
// contracts.ts — the string appears once, here, next to the type it stands for
import { serviceId } from '@eclipse-daanse/tsm'

export interface Greeter { greet(name: string): string }
export const Greeter = serviceId<Greeter>('demo.greeter')
```

```typescript
// modules/polite.ts — a module. `@component` is the whole declaration
import { component } from '@eclipse-daanse/tsm/decorators'
import { Greeter } from '../contracts.js'

@component({ service: [Greeter] })
export class Polite implements Greeter {
  greet(name: string): string { return `Good day, ${name}.` }
}
```

```typescript
// host.ts
import 'reflect-metadata'
import { ModuleLoader } from '@eclipse-daanse/tsm'
import { Greeter } from './contracts.js'

const loader = new ModuleLoader()

loader.register([{
  id: 'polite',
  version: '1.0.0',
  entry: '/modules/polite.js',
  provides: [{ id: 'demo.greeter' }]
}])

await loader.loadAll()

// The type follows from the id — no type argument, no cast
console.log(loader.getServiceRegistry().getRequired(Greeter).greet('world'))
```

`reflect-metadata` is imported once by the host; decorators need it. The `provides` entry lets the resolution
answer questions before the module is fetched — write it by hand, or let the Vite plugin derive it from the
`@component()` declarations.

## The pieces

**Modules** are described by a manifest: an id, a version, an entry, and what it needs and offers. They are
loaded in dependency order, and a module whose requirements are unmet waits in `unsatisfied` instead of
failing — it starts when they arrive.

**Services** are how modules reach each other. A service id is a string, so it can live in a manifest, in a
target filter, and in a capability; `serviceId<T>()` ties that string to the contract it stands for, so a
consumer imports one name and a mismatch is a compile error.

**Components** are classes the loader manages. `@component({ service: [...] })` registers one and runs its
lifecycle; it waits for its own references without stopping its module, takes configuration by PID, and can be
switched off on its own. `@activate`, `@deactivate`, `@modified`, `@bind`/`@unbind`, `@injectAll`.

**Configuration** belongs to the component, not the bundle. A PID decides whether a component runs, how many
instances exist, and what their services publish.

**Requirements and capabilities** make the resolution answerable before anything loads: which modules could
run, which wait, and which wait in vain.

**Features** bundle modules and their configuration into one versioned document — the answer to "which
modules, in which versions, with which configuration".

## Where to read on

| | |
|---|---|
| [`SPEC.md`](SPEC.md) | The specification: every concept, with the reasoning. German. |
| [`docs/CONFORMANCE.md`](docs/CONFORMANCE.md) | Against OSGi Release 8, section by section, with a reason for each departure |
| [`CHANGELOG.md`](CHANGELOG.md) | What changed, and which changes break something |
| [`examples/`](examples) | Six runnable examples, each about one thing |

## Examples

Each one is a small application, not a snippet. `npm run example:<name>`.

| | |
|---|---|
| `whiteboard` | Satisfaction, `0..n` collections, ranking, dynamic requirements — no framework, no build step |
| `config` | Configuration bound to components: a PID deciding whether one runs and how many exist |
| `editors` | Beyond one instance per bundle: conditions, factory components, the field option, per-module services |
| `wiring` | The resolution computed from manifests alone, before anything is loaded |
| `graph` | Bundles, components and the services between them, drawn live from the loader |
| `workbench` | Seven separately built bundles, discovered at runtime |

## DevTools

`installDevtools({ loader })` puts a `tsm` object on the console: `modules()`, `services()`, `components()`,
`factories()`, `conditions()`, `wiring(id)`, `unresolved()`, `config(pid)`, `feature(json)`, and more —
`tsm.help()` lists them. They go through the registry rather than the loader, so a component view can be a
module rather than living in the host.

## Building modules

The Vite plugin derives what the manifest would otherwise repeat, and checks what it cannot derive:

```typescript
import { tsmPlugin, createTsmExternals } from '@eclipse-daanse/tsm/vite'

export default defineConfig({
  plugins: [tsmPlugin({
    manifest: resolve(__dirname, 'manifest.json'),
    components: 'derive',      // `provides` from the @component() declarations
    dependencies: 'derive',    // `dependencies` from the imports actually present
    boundary: { allow: ['../contracts.ts'] }
  })],
  build: { rollupOptions: { external: createTsmExternals(manifest) } }
})
```

`boundary` is the one that will fail a build that used to pass: ES modules have no class loader, so a relative
path into another bundle's sources compiles and copies that bundle's code in, with nothing in the manifest to
show it. What may cross the boundary has to be named.

## Subpath exports

| | |
|---|---|
| `@eclipse-daanse/tsm` | Loader, registry, services, features, capabilities |
| `@eclipse-daanse/tsm/decorators` | `@component`, `@activate`, `@inject`, `@injectAll`, … |
| `@eclipse-daanse/tsm/vite` | `tsmPlugin`, `createTsmExternals` |
| `@eclipse-daanse/tsm/devtools` | `installDevtools` |

Modules import the decorators subpath rather than the root where they can: it carries no loader.

## Development

```bash
npm run build              # tsc
npm run test:run           # 1282 tests
npm run lint
npm run typecheck:examples # the examples are typechecked too
npm run typecheck:types    # type-level assertions in *.test-d.ts
npm run docs:osgi          # fetch the OSGi specifications to read along
```

## License

EPL-2.0
