# Feature Request: Shared Library Registration in ModuleLoader

## Status: IMPLEMENTED

> **Resolved 2025-01-31**: This feature has been fully implemented.

---

## Original Problem

When using TSM with Vue SFC components, the host application needs to register shared libraries (vue, primevue, etc.) **before** any plugins are loaded. Currently:

1. `TsmRuntime` has a `register()` method for shared libraries
2. `ModuleLoader` does not expose this functionality
3. The `__tsm__.require()` calls in plugin bundles fail if libraries aren't pre-registered

## Solution Implemented

### 1. TsmRuntime (`initTsmRuntime()`)

The global `__tsm__` object is created via `initTsmRuntime()` and provides:

```typescript
const tsm = initTsmRuntime()
tsm.register('vue', Vue, '3.4.21')
tsm.register('vue-router', VueRouter, '4.2.5')
tsm.register('primevue/button', { default: Button }, '4.2.5')
```

### 2. ModuleLoader Integration

`ModuleLoader.loadModule()` automatically validates shared dependencies via `validateSharedDependencies()` which uses `tsmRuntime.validate()`.

### 3. Vite Plugin with SFC Support

The `tsmPlugin` now supports Vue SFC components:

```typescript
// vite.config.ts (plugin)
tsmPlugin({
  sharedModules: ['vue', 'vue-router', 'primevue']
})
```

This transforms both:
- Explicit `tsm:` imports: `import { ref } from 'tsm:vue'`
- Bare imports (SFC-generated): `import { openBlock } from 'vue'`

Both become: `const { ref } = __tsm__.require('vue')`

### 4. Working Example

See `examples/shared-libraries/` for a complete working example with:
- Host app registering Vue, Vue-Router, PrimeVue
- Plugin using Vue SFC components
- Full discovery and loading flow

## Original Request Details

<details>
<summary>Original use case and proposed solution (for reference)</summary>

### Use Case

```typescript
// main.ts (host application)
import * as Vue from 'vue'
import { ModuleLoader } from 'tsm'

const loader = new ModuleLoader({ ... })

// Need this BEFORE loading plugins:
loader.registerSharedLibrary('vue', Vue)
loader.registerSharedLibrary('primevue', { Button, Dialog, ... })

// Now plugins can use: __tsm__.require('vue')
await loader.loadModule(pluginManifest)
```

### Original Workaround

Using a separate `TsmRuntime` instance alongside `ModuleLoader`, but this creates two separate registries.

### Proposed Solution

Add `registerSharedLibrary(moduleId: string, exports: unknown)` to `ModuleLoader` that:
1. Stores the library in an internal map
2. Makes it available via `require()` without needing a loaded module

</details>

## Context

This was needed for the Gene project which uses:
- TSM for plugin architecture
- Vue SFC components (which generate bare `import from 'vue'` statements)
- `tsmPlugin({ sharedModules: ['vue', 'primevue'] })` to transform these imports
