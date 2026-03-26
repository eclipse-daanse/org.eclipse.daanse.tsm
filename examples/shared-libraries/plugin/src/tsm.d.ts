/**
 * Type declarations for tsm: imports and Vue SFC
 */

// Vue SFC Module Declaration
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare module 'tsm:vue' {
  export * from 'vue'
}

declare module 'tsm:vue-router' {
  export * from 'vue-router'
}

declare module 'tsm:primevue' {
  export { default as Button } from 'primevue/button'
  export { default as Dialog } from 'primevue/dialog'
  export { default as DataTable } from 'primevue/datatable'
  export { default as Column } from 'primevue/column'
  export { default as InputText } from 'primevue/inputtext'
}

declare module 'tsm:primevue/button' {
  export { default } from 'primevue/button'
}

declare module 'tsm:primevue/dialog' {
  export { default } from 'primevue/dialog'
}

declare module 'tsm:primevue/datatable' {
  export { default } from 'primevue/datatable'
}

declare module 'tsm:primevue/column' {
  export { default } from 'primevue/column'
}