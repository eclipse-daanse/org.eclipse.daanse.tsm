<script setup lang="ts">
/**
 * Vue SFC Component im Plugin
 *
 * Eigene imports mit tsm: Prefix (explizit & lesbar)
 * SFC-generierte imports (openBlock etc.) werden automatisch transformiert
 */
import { ref, computed, onMounted } from 'tsm:vue'
import { useRoute } from 'tsm:vue-router'
import Button from 'tsm:primevue/button'
import DataTable from 'tsm:primevue/datatable'
import Column from 'tsm:primevue/column'
import Dialog from 'tsm:primevue/dialog'

const route = useRoute()

const count = ref(0)
const doubled = computed(() => count.value * 2)

const items = ref([
  { id: 1, name: 'Item A', value: 100 },
  { id: 2, name: 'Item B', value: 200 },
  { id: 3, name: 'Item C', value: 300 }
])

const dialogVisible = ref(false)

onMounted(() => {
  console.log('PluginPanel SFC mounted, route:', route.path)
})

const increment = () => count.value++
const showDialog = () => dialogVisible.value = true
</script>

<template>
  <div class="plugin-panel">
    <h2>Plugin Panel (SFC)</h2>

    <div class="controls">
      <Button
        :label="`Count: ${count} (doubled: ${doubled})`"
        @click="increment"
      />
      <Button
        label="Show Dialog"
        severity="secondary"
        class="ml-2"
        @click="showDialog"
      />
    </div>

    <DataTable :value="items" class="mt-4">
      <Column field="id" header="ID" />
      <Column field="name" header="Name" />
      <Column field="value" header="Value" />
    </DataTable>

    <Dialog
      v-model:visible="dialogVisible"
      header="Plugin Dialog"
      :modal="true"
    >
      <p>This dialog is from the SFC plugin!</p>
    </Dialog>
  </div>
</template>

<style scoped>
.plugin-panel {
  padding: 1rem;
}

.controls {
  margin-bottom: 1rem;
}

.ml-2 {
  margin-left: 0.5rem;
}

.mt-4 {
  margin-top: 1rem;
}
</style>
