# TSM Build Guide

## Übersicht

TSM unterscheidet zwischen zwei Arten von Bundles:

| | App Bundle (Host) | Plugin Bundle |
|---|---|---|
| **Bündelt Shared Libs** | Ja (Vue, PrimeVue, etc.) | Nein |
| **Stellt __tsm__ bereit** | Ja | Nein (nutzt es) |
| **Bundle-Size** | Groß (~500KB+) | Klein (~5-50KB) |
| **Vite lib mode** | Nein | Ja |
| **External** | Nichts | vue, primevue, etc. |

---

## 1. App Bundle Build

### Was passiert?

```
Source                          Build Output
──────                          ────────────
src/
├── main.ts                     dist/
│   import * as Vue             ├── index.html
│   import * as PrimeVue        ├── assets/
│   tsm.register('vue', Vue)    │   ├── main-abc123.js
│                               │   ├── vendor-vue-def456.js    ← Vue gebündelt
└── App.vue                     │   ├── vendor-primevue-ghi789.js
                                │   └── style-xyz.css
```

### vite.config.ts (App)

```typescript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],

  build: {
    rollupOptions: {
      output: {
        // Shared Libraries in separate Chunks
        manualChunks: {
          'vendor-vue': ['vue', 'vue-router'],
          'vendor-primevue': ['primevue', 'primevue/button', ...]
        }
      }
    }
  }
})
```

### main.ts (App)

```typescript
import { initTsmRuntime } from 'tsm'
import * as Vue from 'vue'
import * as PrimeVue from 'primevue'

// 1. Runtime initialisieren
const tsm = initTsmRuntime()

// 2. Shared Libraries registrieren MIT Versionen
tsm.register('vue', Vue, '3.4.21')
tsm.register('primevue', PrimeVue, '4.0.0')

// 3. App starten
// 4. Plugins laden...
```

---

## 2. Plugin Bundle Build

### Was passiert?

```
Source                              Build Output
──────                              ────────────

src/index.ts                        dist/index.js
─────────────                       ──────────────
import { ref } from 'tsm:vue'       const { ref } = __tsm__.require('vue');
import { Button } from 'tsm:pv'     const { Button } = __tsm__.require('primevue');

export function activate() {        export function activate() {
  const count = ref(0)                const count = ref(0);
  ...                                 ...
}                                   }
```

### Die Transformation im Detail

**1. Source Code (was du schreibst):**
```typescript
import { ref, computed } from 'tsm:vue'
import { Button, Dialog } from 'tsm:primevue'
import DefaultExport from 'tsm:some-lib'
import * as Everything from 'tsm:other-lib'
```

**2. Nach tsmPlugin Transformation:**
```javascript
const { ref, computed } = __tsm__.require('vue');
const { Button, Dialog } = __tsm__.require('primevue');
const DefaultExport = __tsm__.require('some-lib').default;
const Everything = __tsm__.require('other-lib');
```

### vite.config.ts (Plugin)

```typescript
import { defineConfig } from 'vite'
import { tsmPlugin } from 'tsm/vite'

export default defineConfig({
  plugins: [
    tsmPlugin()  // Transformiert tsm: Imports
  ],

  build: {
    // Library Mode
    lib: {
      entry: 'src/index.ts',
      formats: ['es']
    },

    rollupOptions: {
      // KRITISCH: Shared Libraries NICHT bündeln!
      external: [
        'vue',
        'vue-router',
        /^vue\/.*/,
        'primevue',
        /^primevue\/.*/,
        /^tsm:/
      ]
    }
  }
})
```

---

## 3. Der tsmPlugin im Detail

### Was er macht:

```typescript
// Regex-basierte Transformation von tsm: Imports

// Named imports: import { x, y } from 'tsm:module'
// → const { x, y } = __tsm__.require('module');

// Default import: import X from 'tsm:module'
// → const X = __tsm__.require('module').default;

// Namespace import: import * as X from 'tsm:module'
// → const X = __tsm__.require('module');

// Mit Alias: import { x as y } from 'tsm:module'
// → const { x: y } = __tsm__.require('module');
```

### Wann transformiert er?

| Phase | Wann | Einstellung |
|-------|------|-------------|
| `transform` | Dev Mode | `useRenderChunk: false` |
| `renderChunk` | Production | `useRenderChunk: true` (default) |

---

## 4. Warum external?

Ohne `external` würde Rollup/Vite versuchen, Vue zu bündeln:

```
❌ OHNE external:

Plugin Source:                    Plugin Build:
import { ref } from 'vue'    →    // Vue komplett eingebunden!
                                  // 150KB+ nur für Vue
                                  // Doppelte Vue-Instanz zur Runtime!
```

```
✅ MIT external + tsm:

Plugin Source:                    Plugin Build:
import { ref } from 'tsm:vue' →   const { ref } = __tsm__.require('vue');
                                  // 0KB für Vue
                                  // Nutzt Vue vom Host
```

---

## 5. Bundle-Size Vergleich

### Szenario: 1 App + 3 Plugins

**Ohne TSM (alles gebündelt):**
```
app.js          450 KB  (Vue, PrimeVue, App-Code)
plugin-a.js     455 KB  (Vue, PrimeVue, Plugin-Code)
plugin-b.js     460 KB  (Vue, PrimeVue, Plugin-Code)
plugin-c.js     448 KB  (Vue, PrimeVue, Plugin-Code)
────────────────────────
Total:        1,813 KB
```

**Mit TSM (Shared Libraries):**
```
app.js          450 KB  (Vue, PrimeVue, App-Code)
plugin-a.js       5 KB  (nur Plugin-Code)
plugin-b.js      10 KB  (nur Plugin-Code)
plugin-c.js       3 KB  (nur Plugin-Code)
────────────────────────
Total:          468 KB  (74% kleiner!)
```

---

## 6. Build Commands

### App Bundle

```bash
cd app

# Development
npm run dev        # vite

# Production Build
npm run build      # vite build

# Preview Production Build
npm run preview    # vite preview
```

### Plugin Bundle

```bash
cd plugin

# Development (watch mode)
npm run dev        # vite build --watch

# Production Build
npm run build      # vite build

# Type Checking
npm run typecheck  # tsc --noEmit
```

---

## 7. package.json Scripts

### App

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "vue": "^3.4.0",
    "vue-router": "^4.2.0",
    "primevue": "^4.0.0",
    "tsm": "^0.2.0"
  }
}
```

### Plugin

```json
{
  "scripts": {
    "dev": "vite build --watch",
    "build": "vite build",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "vue": "^3.4.0",
    "primevue": "^4.0.0",
    "tsm": "^0.2.0",
    "vite": "^5.0.0",
    "typescript": "^5.0.0"
  },
  "peerDependencies": {
    "vue": "^3.4.0",
    "primevue": "^4.0.0"
  }
}
```

**Wichtig bei Plugin:**
- Shared Libraries sind `devDependencies` (für TypeScript/IDE)
- Und `peerDependencies` (dokumentiert was benötigt wird)
- NICHT `dependencies`!

---

## 8. TypeScript Konfiguration

### Plugin tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "declaration": true,
    "declarationDir": "dist/types",
    "outDir": "dist",

    // Wichtig für tsm: Imports
    "paths": {
      "tsm:*": ["./node_modules/*"]
    }
  },
  "include": ["src"]
}
```

Oder mit eigenem Type-Declaration File:

```typescript
// src/tsm.d.ts
declare module 'tsm:vue' {
  export * from 'vue'
}

declare module 'tsm:primevue' {
  export * from 'primevue'
  export { default as Button } from 'primevue/button'
  export { default as Dialog } from 'primevue/dialog'
}
```

---

## 9. Troubleshooting

### Problem: "Vue is not defined"

**Ursache:** Plugin wurde geladen bevor `__tsm__.register('vue', ...)` aufgerufen wurde.

**Lösung:** Sicherstellen dass App die Libraries registriert BEVOR Plugins geladen werden.

### Problem: "Cannot find module 'tsm:vue'"

**Ursache:** TypeScript kennt den `tsm:` Prefix nicht.

**Lösung:** Type Declaration hinzufügen (siehe oben).

### Problem: Plugin bündelt Vue trotzdem

**Ursache:** `external` nicht korrekt konfiguriert.

**Lösung:** Prüfen ob alle Patterns in `external` sind:
```typescript
external: [
  'vue',
  /^vue\/.*/,      // Wichtig!
  /^@vue\/.*/,     // Wichtig!
  /^tsm:/
]
```

### Problem: Doppelte Vue-Instanz

**Symptome:** Reactivity funktioniert nicht über Plugin-Grenzen.

**Ursache:** Plugin hat eigene Vue-Instanz gebündelt.

**Prüfung:**
```javascript
// In Browser Console
console.log(window.__tsm__.require('vue') === pluginVue)
// Sollte true sein!
```
