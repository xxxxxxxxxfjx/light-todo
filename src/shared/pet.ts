import type { Task } from './types'

export const PET_SIZE = { width: 208, height: 220 }

export interface PetSettings {
  enabled: boolean
  skin: 'cat' | 'bunny'
  scale: number
  opacity: number
}

export interface PetState {
  settings: PetSettings
  tasks: Task[]
  displayScale: number
}

export const DEFAULT_PET_SETTINGS: PetSettings = {
  enabled: true, skin: 'cat', scale: 1, opacity: 1
}
