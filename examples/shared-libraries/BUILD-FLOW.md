# Build Flow: Shared Libraries

## 1. App Bundle Build

```bash
cd app && npm run build
```

**Input:** `app/src/main.ts`
```typescript
import * as Vue from 'vue'
import * as PrimeVue from 'primevue'
import { tsmRuntime } from './tsm-runtime'

tsmRuntime.register('vue', Vue)
tsmRuntime.register('primevue', PrimeVue)
```

**Output:** `app/dist/`
```
dist/
├── index.html
├── assets/
│   ├── index-[hash].js        # App Code
│   ├── vendor-vue-[hash].js   # Vue + Vue-Router gebündelt
│   └── vendor-primevue-[hash].js  # PrimeVue gebündelt
```

Vue und PrimeVue sind **komplett gebündelt** im App Bundle.

---

## 2. Plugin Bundle Build

```bash
cd plugin && npm run build
```

**Input:** `plugin/src/index.ts`
```typescript
import { ref, computed } from 'tsm:vue'
import { Button, Dialog } from 'tsm:primevue'

export const MyComponent = defineComponent({
  setup() {
    const count = ref(0)
    return { count }
  },
  render() {
    return h(Button, { label: 'Click' })
  }
})
```

**Nach TSM Plugin Transformation:**
```javascript
const { ref, computed } = __tsm__.require('vue');
const { Button, Dialog } = __tsm__.require('primevue');

export const MyComponent = defineComponent({
  setup() {
    const count = ref(0)
    return { count }
  },
  render() {
    return h(Button, { label: 'Click' })
  }
})
```

**Output:** `plugin/dist/index.js`
- **Kein Vue gebündelt** (external)
- **Kein PrimeVue gebündelt** (external)
- Nur Plugin-Code (~5KB statt ~500KB)

---

## 3. Runtime Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Browser                                                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. index.html lädt app/dist/index.js                           │
│     ↓                                                            │
│  2. App Bundle führt aus:                                        │
│     - import * as Vue from 'vue'     (gebündelt)                │
│     - tsmRuntime.register('vue', Vue)                           │
│     - window.__tsm__ = tsmRuntime                               │
│     ↓                                                            │
│  3. App lädt Plugin:                                             │
│     - const plugin = await import('plugin/dist/index.js')       │
│     ↓                                                            │
│  4. Plugin führt aus:                                            │
│     - const { ref } = __tsm__.require('vue')                    │
│       → findet Vue in tsmRuntime                                │
│     - const { Button } = __tsm__.require('primevue')            │
│       → findet PrimeVue in tsmRuntime                           │
│     ↓                                                            │
│  5. Plugin Component nutzt das GLEICHE Vue wie App              │
│     → Singleton, keine doppelten Instanzen                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Bundle Größen (Beispiel)

| Bundle | Mit Shared Libs | Ohne (alles gebündelt) |
|--------|-----------------|------------------------|
| App Bundle | ~450 KB | ~450 KB |
| Plugin A | ~5 KB | ~455 KB |
| Plugin B | ~8 KB | ~458 KB |
| Plugin C | ~3 KB | ~453 KB |
| **Total** | **~466 KB** | **~1816 KB** |

Ersparnis: **~75%** weniger Download bei 3 Plugins!

---

## 5. Wichtige Punkte

### App Bundle MUSS:
1. `__tsm__` global bereitstellen BEVOR Plugins geladen werden
2. Alle Shared Libraries registrieren
3. Gleiche Versionen verwenden wie Plugins erwarten

### Plugin Bundle MUSS:
1. `tsm:` Prefix für Shared Library Imports verwenden
2. Shared Libraries als `external` im Build markieren
3. TSM Vite Plugin verwenden für Transformation

### Versionierung
- App deklariert: "Ich biete Vue 3.4.x"
- Plugin deklariert: "Ich brauche Vue ^3.4.0"
- TSM prüft Kompatibilität beim Laden