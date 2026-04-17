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
