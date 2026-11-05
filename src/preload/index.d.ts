import type { Api } from './index'
import type { PetApi } from './pet'
import type { IslandApi } from './island'

declare global {
  interface Window {
    api: Api
    petApi: PetApi
    islandApi: IslandApi
  }
}

export {}
