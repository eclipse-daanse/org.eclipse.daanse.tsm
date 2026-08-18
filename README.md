# TSM - TypeScript Module System

Runtime module loading system for TypeScript/JavaScript applications. Enables dynamic plugin architectures with dependency management, service injection, lifecycle hooks, and hot reload capabilities.

## Features

- **Dynamic Module Loading** - Load modules at runtime via HTTP or dynamic imports
- **Dependency Injection** - Built-in service registry with singleton and transient scopes
- **Lifecycle Management** - `activate()` and `deactivate()` hooks for modules
- **Dependency Resolution** - Automatic resolution with SemVer support and cycle detection
- **Plugin Discovery** - Discover and install plugins from remote repositories
- **Shared Libraries** - Global `__tsm__` runtime for shared dependencies (e.g. Vue, PrimeVue)
- **Hot Reload** - Live module reloading during development
- **Vite Plugin** - First-class Vite integration for building plugins

## Installation

```bash
npm install @eclipse-daanse/tsm
```

## Quick Start

### Host Application

```typescript
import { ModuleLoader, ServiceRegistry, initTsmRuntime } from '@eclipse-daanse/tsm'

// Set up shared libraries
const tsm = initTsmRuntime()
tsm.register('vue', Vue, '3.4.21')

// Create module loader
const services = new ServiceRegistry()
const loader = new ModuleLoader({ services })

// Load a plugin
await loader.register({
  id: 'my-plugin',
  name: 'My Plugin',
  version: '1.0.0',
  entry: '/plugins/my-plugin/index.js'
})

await loader.loadAll()
```

### Plugin

```typescript
// manifest.json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "entry": "index.js",
  "provides": [
    { "id": "my-plugin.service", "scope": "singleton" }
  ],
  "sharedDependencies": [
    { "id": "vue", "versionRange": "^3.4.0" }
  ]
}
```

```typescript
// index.ts
import { ref } from 'tsm:vue'

export function activate(context) {
  // Plugin initialization
}

export function deactivate() {
  // Cleanup
}
```

### Vite Plugin (for building plugins)

```typescript
// vite.config.ts
import { tsmPlugin, createTsmExternals } from '@eclipse-daanse/tsm/vite'

export default defineConfig({
  plugins: [
    tsmPlugin({ sharedModules: ['vue', 'primevue'] })
  ],
  build: {
    rollupOptions: {
      external: createTsmExternals(['vue', 'primevue'])
    }
  }
})
```

## Module Lifecycle

```
registered → resolving → loading → activating → active → deactivating → stopped
```

## Decorators

```typescript
import { injectable, inject, singleton } from '@eclipse-daanse/tsm'

@injectable()
@singleton()
class MyService {
  @inject('logger.service')
  private logger!: Logger
}
```

## API

| Class | Description |
|-------|-------------|
| `ModuleLoader` | Core loader - register, load, unload, reload modules |
| `PluginRegistry` | Discover plugins from repositories, check for updates |
| `DependencyResolver` | Resolve dependencies, detect cycles, validate versions |
| `ServiceRegistry` | Dependency injection container |
| `TsmRuntime` | Global shared library management (`__tsm__`) |

### Subpath exports

| Import | Description |
|--------|-------------|
| `@eclipse-daanse/tsm/vite` | Vite plugin: `tsm:` import transform, manifest validation |
| `@eclipse-daanse/tsm/devtools` | Console commands for inspecting a running application |

## DevTools

```typescript
import { installDevtools } from '@eclipse-daanse/tsm/devtools'

installDevtools({ loader, registry, resolver, runtime })
// in the browser console:
//   tsm.help()
//   tsm.modules()        every known module with its state
//   tsm.unsatisfied()    what is waiting, and for what
//   tsm.providers('ui.layout')   every registration, best first
//   tsm.consumers('ui.layout')   which modules asked for it
//   tsm.disable('heavy-module')  stop it and keep it stopped
```

`loader` is required, the rest is optional — a command whose collaborator is
missing says so instead of failing. By default the commands are installed on
`globalThis.tsm`; `target` and `name` change that, `target: null` installs
nowhere and only returns the object.

Output goes through a sink, so the commands are usable outside a browser:

```typescript
import { installDevtools, collectingOutput } from '@eclipse-daanse/tsm/devtools'

const out = collectingOutput()
installDevtools({ loader, target: null, output: out }).unsatisfied()
console.log(out.text())
```

To ship them as a module instead of wiring them in the host, a three-line
`activate` is enough:

```typescript
export function activate(context: ModuleContext) {
  installDevtools({ loader: context.services.getRequired('tsm.loader') })
}
```

## Development

```bash
npm install        # Install dependencies
npm run build      # Build the library
npm run test:run   # Run tests
npm run dev        # Watch mode
npm run demo       # Start demo app on port 3000
```

## License

MIT
