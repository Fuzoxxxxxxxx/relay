import type { NexoraApi } from './shared/types'

declare global {
  interface Window {
    nexora: NexoraApi
  }
}

export {}
