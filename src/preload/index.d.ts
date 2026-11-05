import type { Api } from './index'
import type { PetApi } from './pet'

declare global {
  interface Window {
    api: Api
    petApi: PetApi
  }
}

export {}
