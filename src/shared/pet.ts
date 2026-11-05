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

// 新安装默认关闭，避免为未使用的桌宠付出启动与常驻内存成本。
export const DEFAULT_PET_SETTINGS: PetSettings = {
  enabled: false, skin: 'cat', scale: 1, opacity: 1
}

// 升级用户没有显式 pet_settings 时沿用旧版「默认开启」，不改变既有体验。
export const LEGACY_PET_SETTINGS: PetSettings = {
  ...DEFAULT_PET_SETTINGS,
  enabled: true
}
