<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import Button from 'primevue/button'
import { PluginRegistry, ModuleLoader } from 'tsm'
import type { DiscoveredModule, ModuleManifest } from 'tsm'

const pluginLoaded = ref(false)
const pluginComponent = ref<any>(null)
const error = ref<string | null>(null)
const discoveredPlugins = ref<DiscoveredModule[]>([])
const loadingState = ref<'idle' | 'discovering' | 'loading' | 'done'>('idle')

// __tsm__ für Template verfügbar machen
const registeredLibraries = computed(() => {
  return Array.from(window.__tsm__.getRegistered().entries())
})

// Registry und Loader Instanzen
const registry = new PluginRegistry()
const loader = new ModuleLoader()

// Repository hinzufügen
registry.addRepository({
  id: 'local',
  name: 'Local Plugins',
  url: '/plugins'
})

async function discoverPlugins() {
  loadingState.value = 'discovering'
  try {
    discoveredPlugins.value = await registry.discoverAll()
    console.log('Discovered plugins:', discoveredPlugins.value)
  } catch (e) {
    console.error('Failed to discover plugins:', e)
    error.value = String(e)
  }
}

async function loadPlugin(manifest: ModuleManifest) {
  loadingState.value = 'loading'
  try {
    // Plugin-Code via fetch laden und als Blob-URL importieren
    const response = await fetch(manifest.entry)
    if (!response.ok) {
      throw new Error(`Failed to fetch plugin: ${response.status}`)
    }
    const code = await response.text()
    const blob = new Blob([code], { type: 'application/javascript' })
    const blobUrl = URL.createObjectURL(blob)

    // Dynamisch importieren
    const plugin = await import(/* @vite-ignore */ blobUrl)
    URL.revokeObjectURL(blobUrl)

    console.log('Plugin loaded:', plugin)

    // Lifecycle aufrufen
    if (plugin.activate) {
      plugin.activate({
        manifest,
        services: loader.getServiceRegistry(),
        log: console
      })
    }

    // Component aus exports holen
    if (plugin.MyPluginPanel) {
      pluginComponent.value = plugin.MyPluginPanel
    }

    pluginLoaded.value = true
    loadingState.value = 'done'
  } catch (e) {
    console.error('Failed to load plugin:', e)
    error.value = String(e)
    loadingState.value = 'idle'
  }
}

onMounted(async () => {
  console.log('App mounted')
  console.log('Registered shared libraries:', window.__tsm__.getRegistered())

  // Auto-discover plugins
  await discoverPlugins()
})
</script>

<template>
  <div class="app">
    <h1>TSM Example App</h1>

    <div class="info">
      <h2>Registered Shared Libraries:</h2>
      <ul>
        <li v-for="[id, info] in registeredLibraries" :key="id">
          <strong>{{ id }}</strong> @ {{ info.version }}
        </li>
      </ul>
    </div>

    <div class="discovered" v-if="discoveredPlugins.length > 0">
      <h2>Discovered Plugins:</h2>
      <div v-for="plugin in discoveredPlugins" :key="plugin.manifest.id" class="plugin-card">
        <h3>{{ plugin.manifest.name }}</h3>
        <p>{{ plugin.manifest.description }}</p>
        <p class="version">v{{ plugin.manifest.version }}</p>
        <p class="entry">Entry: {{ plugin.manifest.entry }}</p>
        <Button
          :label="pluginLoaded ? 'Loaded' : 'Load Plugin'"
          icon="pi pi-download"
          @click="loadPlugin(plugin.manifest)"
          :disabled="pluginLoaded || loadingState === 'loading'"
          :loading="loadingState === 'loading'"
        />
      </div>
    </div>

    <div v-else-if="loadingState === 'discovering'" class="loading">
      Discovering plugins...
    </div>

    <div v-if="error" class="error">
      <h3>Error:</h3>
      <pre>{{ error }}</pre>
    </div>

    <div v-if="pluginLoaded" class="plugin-container">
      <h2>Plugin Loaded!</h2>
      <component :is="pluginComponent" v-if="pluginComponent" />
    </div>
  </div>
</template>

<style>
.app {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem;
  font-family: system-ui, -apple-system, sans-serif;
}

.info {
  background: #f5f5f5;
  padding: 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
}

.info ul {
  margin: 0;
  padding-left: 1.5rem;
}

.actions {
  margin: 1rem 0;
}

.error {
  background: #fee;
  border: 1px solid #f00;
  padding: 1rem;
  border-radius: 8px;
  margin: 1rem 0;
}

.error pre {
  margin: 0;
  white-space: pre-wrap;
}

.plugin-container {
  border: 2px solid #4caf50;
  padding: 1rem;
  border-radius: 8px;
  margin-top: 1rem;
}

.discovered {
  margin: 1rem 0;
}

.plugin-card {
  background: #f9f9f9;
  border: 1px solid #ddd;
  padding: 1rem;
  border-radius: 8px;
  margin-bottom: 0.5rem;
}

.plugin-card h3 {
  margin: 0 0 0.5rem 0;
}

.plugin-card p {
  margin: 0.25rem 0;
  color: #666;
}

.plugin-card .version {
  font-family: monospace;
  color: #888;
}

.plugin-card .entry {
  font-size: 0.85em;
  font-family: monospace;
  color: #999;
}

.loading {
  padding: 1rem;
  color: #666;
  font-style: italic;
}
</style>