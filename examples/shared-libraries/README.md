# Shared Libraries Example

> **Build the package first.** Unlike the other examples, this one installs tsm as
> a dependency (`"tsm": "file:../../.."`) and therefore uses the **built** package
> from `dist/`, not the sources. After changing anything in `src/`, run
> `npm run build` in the repository root — otherwise the plugin and loader here are
> the previous version. `examples/graph`, `config`, `whiteboard` and `workbench` map
> `@eclipse-daanse/tsm` onto `src/` with a Vite alias and always see current code.
>
> What decides which libraries stay external is `manifest.json`:
> `createTsmExternals(manifest)` reads its `sharedDependencies`, and
> `tsmPlugin({ manifest })` fails the build if one of them is bundled anyway — that
> would give this plugin its own copy of Vue, and nothing at runtime would notice.

## Architektur

```
┌─────────────────────────────────────────────────────────────┐
│                      App Bundle (Host)                       │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │     Vue     │  │ Vue-Router  │  │      PrimeVue       │  │
│  │  (bundled)  │  │  (bundled)  │  │     (bundled)       │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         │                │                     │             │
│         └────────────────┼─────────────────────┘             │
│                          ▼                                   │
│                   ┌─────────────┐                            │
│                   │   __tsm__   │                            │
│                   │             │                            │
│                   │ .require()  │◀─── globales Objekt        │
│                   │ .register() │                            │
│                   └─────────────┘                            │
└─────────────────────────────────────────────────────────────┘
                           │
                           │  __tsm__.require('vue')
                           │  __tsm__.require('primevue')
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                     Plugin Bundle                            │
│                                                              │
│  // Source Code:                                             │
│  import { ref, computed } from 'tsm:vue'                    │
│  import { useRouter } from 'tsm:vue-router'                 │
│  import { Button } from 'tsm:primevue'                      │
│                                                              │
│  // Nach Build (transformiert):                              │
│  const { ref, computed } = __tsm__.require('vue')           │
│  const { useRouter } = __tsm__.require('vue-router')        │
│  const { Button } = __tsm__.require('primevue')             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Dateien

### App Bundle

- `app/vite.config.ts` - Build-Konfiguration
- `app/src/main.ts` - TSM Setup & Library Registration
- `app/src/tsm-runtime.ts` - Das `__tsm__` Runtime-Objekt

### Plugin Bundle

- `plugin/vite.config.ts` - Build mit externals
- `plugin/src/index.ts` - Plugin Code mit tsm: Imports
- `plugin/manifest.json` - Plugin Manifest