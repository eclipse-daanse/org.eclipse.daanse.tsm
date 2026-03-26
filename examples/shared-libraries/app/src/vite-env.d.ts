/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

import type { TsmRuntime } from 'tsm'

declare global {
  interface Window {
    __tsm__: TsmRuntime
  }
}
