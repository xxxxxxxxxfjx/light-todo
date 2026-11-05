import { contextBridge, ipcRenderer } from 'electron'
import type { PetSettings } from '../shared/pet'
import type {
  CreateTaskInput,
  List,
  UpdateTaskInput,
  ViewKey
} from '../shared/types'

const api = {
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
  tasks: {
    list: (opts: { view: ViewKey; listId?: string; tagId?: string; limit?: number; offset?: number; dateFrom?: string; dateTo?: string }) =>
      ipcRenderer.invoke('tasks:list', opts),
    get: (id: string) => ipcRenderer.invoke('tasks:get', id),
    create: (input: CreateTaskInput) => ipcRenderer.invoke('tasks:create', input),
    update: (id: string, patch: UpdateTaskInput) => ipcRenderer.invoke('tasks:update', id, patch),
    setStatus: (id: string, done: boolean) => ipcRenderer.invoke('tasks:setStatus', id, done),
    remove: (id: string) => ipcRenderer.invoke('tasks:delete', id),
    restore: (id: string) => ipcRenderer.invoke('tasks:restore', id),
    purge: (id: string) => ipcRenderer.invoke('tasks:purge', id),
    reorder: (items: { id: string; sortOrder: number }[]) =>
      ipcRenderer.invoke('tasks:reorder', items)
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
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
