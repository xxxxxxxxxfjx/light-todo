import type { Task } from './types'

export type IslandAccent = 'purple' | 'blue' | 'teal' | 'green' | 'orange' | 'pink'

export interface IslandSettings {
  enabled: boolean
  accent: IslandAccent
}

export const DEFAULT_ISLAND_SETTINGS: IslandSettings = { enabled: true, accent: 'purple' }

export const ISLAND_ACCENTS: Record<IslandAccent, string> = {
  purple: '#c9a7e8',
  blue: '#7fb2ff',
  teal: '#5fd4c4',
  green: '#6fd39a',
  orange: '#f0b26b',
  pink: '#f19bb8'
}

export interface IslandNext {
  id: string
  title: string
  /** 展示用时间：dueAt 的 HH:mm，或「今天」 */
  at: string | null
  /** 距离到期还有多少分钟；无 dueAt 时为 null */
  minutesLeft: number | null
}

export interface IslandState {
  settings: IslandSettings
  theme: 'light' | 'dark'
  tasks: Task[]
  stats: {
    total: number
    done: number
    remaining: number
    overdue: number
    /** 60 分钟内到期 */
    soon: number
  }
  next: IslandNext | null
}

/** 固定舞台尺寸：胶囊在里面形变，窗口本身不动 */
export const ISLAND_STAGE = { width: 640, height: 420 }

/** 各状态的胶囊尺寸（渲染层与命中判定共用一套） */
export const ISLAND_CAPSULE: Record<'rest' | 'peek' | 'panel', { w: number; h: number }> = {
  rest: { w: 140, h: 30 },
  peek: { w: 340, h: 58 },
  panel: { w: 560, h: 360 }
}
