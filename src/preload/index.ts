import { contextBridge, ipcRenderer } from 'electron'
import type { PetSettings } from '../shared/pet'
import type { IslandSettings } from '../shared/island'
import type {
  CaptureResult,
  CreateTaskInput,
  DayReview,
  FilterQuery,
  List,
  ListSection,
  SavedFilter,
  ShortcutInfo,
  ShortcutKind,
  Task,
  UpdateTaskInput,
  ViewKey,
  WeeklyReviewData
} from '../shared/types'

export interface CalendarSubscriptionView {
  id: number
  url: string
  name: string | null
  lastSyncedAt: string | null
  lastError: string | null
  updatedAt: string
}

export interface CalendarEventView {
  id: string
  subscriptionId: string
  uid: string | null
  title: string
  description: string | null
  startAt: string
  endAt: string | null
  allDay: boolean
  rrule: string | null
  updatedAt: string
}

export interface CalendarSyncResultView {
  url: string
  count: number
  name?: string
}

const api = {
  island: {
    settings: (): Promise<IslandSettings> => ipcRenderer.invoke('island:settings'),
    setSettings: (patch: Partial<IslandSettings>): Promise<IslandSettings> => ipcRenderer.invoke('island:setSettings', patch),
    onSettings: (cb: (settings: IslandSettings) => void) => {
      const listener = (_e: unknown, settings: IslandSettings): void => cb(settings)
      ipcRenderer.on('island:settings', listener)
      return (): void => { ipcRenderer.removeListener('island:settings', listener) }
    }
  },
  pet: {
    settings: (): Promise<PetSettings> => ipcRenderer.invoke('pet:settings'),
    setSettings: (patch: Partial<PetSettings>): Promise<PetSettings> => ipcRenderer.invoke('pet:setSettings', patch),
    reset: (): Promise<boolean> => ipcRenderer.invoke('pet:reset'),
    onSettings: (cb: (settings: PetSettings) => void) => {
      const listener = (_e: unknown, settings: PetSettings): void => cb(settings)
      ipcRenderer.on('pet:settings', listener)
      return (): void => { ipcRenderer.removeListener('pet:settings', listener) }
    }
  },
  onTasksChanged: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('tasks:changed', listener)
    return (): void => { ipcRenderer.removeListener('tasks:changed', listener) }
  },
  onSettings: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('ui:settings', listener)
    return (): void => { ipcRenderer.removeListener('ui:settings', listener) }
  },
  app: {
    setTheme: (theme: 'system' | 'light' | 'dark') => ipcRenderer.invoke('app:setTheme', theme),
    info: () => ipcRenderer.invoke('app:info'),
    openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url)
  },
  sidebar: {
    get: () => ipcRenderer.invoke('sidebar:get')
  },
  review: {
    get: (): Promise<WeeklyReviewData> => ipcRenderer.invoke('review:get'),
    day: (date: string): Promise<DayReview | null> => ipcRenderer.invoke('review:day', date),
    saveDay: (date: string, rating: number | null, note: string): Promise<DayReview> =>
      ipcRenderer.invoke('review:saveDay', date, rating, note),
    dates: (from: string, to: string): Promise<string[]> => ipcRenderer.invoke('review:dates', from, to),
    shouldPrompt: (): Promise<boolean> => ipcRenderer.invoke('review:shouldPrompt')
  },
  replan: {
    list: (): Promise<Task[]> => ipcRenderer.invoke('replan:list'),
    act: (id: string, action: 'complete' | 'today' | 'tomorrow' | 'date' | 'someday', date?: string | null): Promise<Task | null> =>
      ipcRenderer.invoke('replan:act', id, action, date)
  },
  sections: {
    list: (listId: string): Promise<ListSection[]> => ipcRenderer.invoke('sections:list', listId),
    create: (listId: string, name: string): Promise<ListSection> =>
      ipcRenderer.invoke('sections:create', listId, name),
    update: (id: string, patch: { name?: string; collapsed?: boolean; sortOrder?: number }): Promise<void> =>
      ipcRenderer.invoke('sections:update', id, patch),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('sections:delete', id)
  },
  filters: {
    list: (): Promise<SavedFilter[]> => ipcRenderer.invoke('filters:list'),
    create: (input: { name: string; query: FilterQuery; color?: string | null }): Promise<SavedFilter> =>
      ipcRenderer.invoke('filters:create', input),
    update: (id: string, patch: { name?: string; query?: FilterQuery; color?: string | null; pinned?: number }): Promise<SavedFilter> =>
      ipcRenderer.invoke('filters:update', id, patch),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('filters:delete', id),
    preview: (query: FilterQuery): Promise<number> => ipcRenderer.invoke('filters:preview', query)
  },
  calendar: {
    syncIcs: (url: string): Promise<CalendarSyncResultView> =>
      ipcRenderer.invoke('calendar:syncIcs', url),
    getEvents: (from: string, to: string): Promise<CalendarEventView[]> =>
      ipcRenderer.invoke('calendar:getEvents', from, to),
    getSubscription: (): Promise<CalendarSubscriptionView | null> =>
      ipcRenderer.invoke('calendar:getSubscription'),
    clearIcs: (): Promise<void> => ipcRenderer.invoke('calendar:clearIcs')
  },
  tasks: {
    list: (opts: { view: ViewKey; listId?: string; tagId?: string; filterId?: string; limit?: number; offset?: number; dateFrom?: string; dateTo?: string }) =>
      ipcRenderer.invoke('tasks:list', opts),
    get: (id: string) => ipcRenderer.invoke('tasks:get', id),
    create: (input: CreateTaskInput) => ipcRenderer.invoke('tasks:create', input),
    update: (id: string, patch: UpdateTaskInput) => ipcRenderer.invoke('tasks:update', id, patch),
    setStatus: (id: string, done: boolean) => ipcRenderer.invoke('tasks:setStatus', id, done),
    remove: (id: string) => ipcRenderer.invoke('tasks:delete', id),
    restore: (id: string) => ipcRenderer.invoke('tasks:restore', id),
    purge: (id: string) => ipcRenderer.invoke('tasks:purge', id),
    reorder: (items: { id: string; sortOrder: number }[]) =>
      ipcRenderer.invoke('tasks:reorder', items),
    addTime: (id: string, startedAt: string, endedAt: string): Promise<Task> =>
      ipcRenderer.invoke('tasks:addTime', id, startedAt, endedAt)
  },
  lists: {
    create: (input: { name: string; color?: string; icon?: string; folderId?: string | null }) =>
      ipcRenderer.invoke('lists:create', input),
    update: (id: string, patch: Partial<Pick<List, 'name' | 'color' | 'icon' | 'folderId' | 'isPinned'>>) =>
      ipcRenderer.invoke('lists:update', id, patch),
    remove: (id: string) => ipcRenderer.invoke('lists:delete', id)
  },
  folders: {
    create: (name: string) => ipcRenderer.invoke('folders:create', name),
    update: (id: string, patch: { name: string }) => ipcRenderer.invoke('folders:update', id, patch),
    remove: (id: string) => ipcRenderer.invoke('folders:delete', id)
  },
  tags: {
    create: (name: string, color?: string) => ipcRenderer.invoke('tags:create', name, color),
    update: (id: string, patch: { name?: string; color?: string | null }) =>
      ipcRenderer.invoke('tags:update', id, patch),
    remove: (id: string) => ipcRenderer.invoke('tags:delete', id)
  },
  search: {
    query: (q: string) => ipcRenderer.invoke('search:query', q)
  },
  shortcuts: {
    list: (): Promise<ShortcutInfo[]> => ipcRenderer.invoke('shortcuts:list'),
    set: (kind: ShortcutKind, accelerator: string): Promise<ShortcutInfo[]> =>
      ipcRenderer.invoke('shortcuts:set', kind, accelerator),
    reset: (kind: ShortcutKind): Promise<ShortcutInfo[]> => ipcRenderer.invoke('shortcuts:reset', kind)
  },
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value)
  },
  data: {
    backup: () => ipcRenderer.invoke('data:backup'),
    backups: () => ipcRenderer.invoke('data:backups'),
    exportJson: () => ipcRenderer.invoke('data:exportJson'),
    exportMarkdown: () => ipcRenderer.invoke('data:exportMarkdown'),
    exportCsv: () => ipcRenderer.invoke('data:exportCsv'),
    exportIcs: () => ipcRenderer.invoke('data:exportIcs'),
    openBackups: () => ipcRenderer.invoke('data:openBackups'),
    import: () => ipcRenderer.invoke('data:import'),
    clearCompleted: () => ipcRenderer.invoke('data:clearCompleted'),
    restoreBackup: (name: string) => ipcRenderer.invoke('data:restoreBackup', name),
    restoreFromFile: (): Promise<{ ok: boolean; message?: string }> =>
      ipcRenderer.invoke('data:restoreFromFile'),
    getLoginItem: () => ipcRenderer.invoke('app:getLoginItem'),
    setLoginItem: (enabled: boolean) => ipcRenderer.invoke('app:setLoginItem', enabled)
  },
  onQuickAdd: (cb: (text?: string) => void) => {
    const listener = (_e: unknown, text?: string): void => cb(text)
    ipcRenderer.on('ui:quick-add', listener)
    return (): void => {
      ipcRenderer.removeListener('ui:quick-add', listener)
    }
  },
  onOpenTask: (cb: (id: string) => void) => {
    const listener = (_e: unknown, id: string): void => cb(id)
    ipcRenderer.on('ui:open-task', listener)
    return (): void => {
      ipcRenderer.removeListener('ui:open-task', listener)
    }
  },
  onShutdown: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('ui:shutdown', listener)
    return (): void => {
      ipcRenderer.removeListener('ui:shutdown', listener)
    }
  },
  onCaptureResult: (cb: (result: CaptureResult) => void) => {
    const listener = (_e: unknown, result: CaptureResult): void => cb(result)
    ipcRenderer.on('ui:capture-result', listener)
    return (): void => {
      ipcRenderer.removeListener('ui:capture-result', listener)
    }
  },
  onDataMigrated: (cb: (info: { from: string; tasks: number }) => void) => {
    const listener = (_e: unknown, info: { from: string; tasks: number }): void => cb(info)
    ipcRenderer.on('ui:data-migrated', listener)
    return (): void => {
      ipcRenderer.removeListener('ui:data-migrated', listener)
    }
  },
  capture: {
    copyImage: (dataUrl: string): Promise<boolean> => ipcRenderer.invoke('capture:copyImage', dataUrl),
    copyText: (text: string): Promise<boolean> => ipcRenderer.invoke('capture:copyText', text)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
