/**
 * App Bundle - Main Entry Point
 *
 * Registriert Shared Libraries und startet die App.
 */

// 1. TSM Runtime initialisieren (MUSS zuerst kommen!)
import { initTsmRuntime } from 'tsm'

// 2. Shared Libraries importieren
import * as Vue from 'vue'
import * as VueRouter from 'vue-router'

// PrimeVue Core und Components
import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import InputText from 'primevue/inputtext'

// Versionen (aus package.json)
const VERSIONS = {
  vue: '3.4.21',
  'vue-router': '4.2.5',
  primevue: '4.2.5'
}

// 3. TSM Runtime initialisieren und Libraries registrieren MIT Versionen
const tsm = initTsmRuntime()

tsm.register('vue', Vue, VERSIONS.vue)
tsm.register('vue-router', VueRouter, VERSIONS['vue-router'])

// PrimeVue als Sammlung registrieren
tsm.register('primevue', {
  Button,
  Dialog,
  DataTable,
  Column,
  InputText
}, VERSIONS.primevue)

// PrimeVue Subpaths für SFC imports (import Button from 'tsm:primevue/button')
tsm.register('primevue/button', { default: Button }, VERSIONS.primevue)
tsm.register('primevue/dialog', { default: Dialog }, VERSIONS.primevue)
tsm.register('primevue/datatable', { default: DataTable }, VERSIONS.primevue)
tsm.register('primevue/column', { default: Column }, VERSIONS.primevue)
tsm.register('primevue/inputtext', { default: InputText }, VERSIONS.primevue)

console.log('[App] Shared libraries registered:')
for (const [id, info] of tsm.getRegistered()) {
  console.log(`  - ${id}@${info.version}`)
}

// 4. App starten
import App from './App.vue'
import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: App }
  ]
})

const app = Vue.createApp(App)
app.use(router)
app.use(PrimeVue, {
  theme: {
    preset: Aura
  }
})
app.mount('#app')

console.log('[App] Started')