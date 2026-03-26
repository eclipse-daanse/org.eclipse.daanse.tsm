# Shared Libraries Example

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