import { contextBridge, ipcRenderer } from 'electron'
import type {
  CreateTaskInput,
  UpdateTaskInput,
  ViewKey
} from '../shared/types'

const api = {
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    openDataDir: () => ipcRenderer.invoke('app:openDataDir')
  },
  sidebar: {
    get: () => ipcRenderer.invoke('sidebar:get')
  },
  tasks: {
    list: (opts: { view: ViewKey; listId?: string; tagId?: string; limit?: number }) =>
      ipcRenderer.invoke('tasks:list', opts),
    get: (id: string) => ipcRenderer.invoke('tasks:get', id),
    create: (input: CreateTaskInput) => ipcRenderer.invoke('tasks:create', input),
    update: (id: string, patch: UpdateTaskInput) => ipcRenderer.invoke('tasks:update', id, patch),
    setStatus: (id: string, done: boolean) => ipcRenderer.invoke('tasks:setStatus', id, done),
    remove: (id: string) => ipcRenderer.invoke('tasks:delete', id),
    restore: (id: string) => ipcRenderer.invoke('tasks:restore', id),
    reorder: (items: { id: string; sortOrder: number }[]) =>
      ipcRenderer.invoke('tasks:reorder', items)
  },
  lists: {
    create: (input: { name: string; color?: string; icon?: string; folderId?: string | null }) =>
      ipcRenderer.invoke('lists:create', input),
    update: (id: string, patch: Record<string, unknown>) => ipcRenderer.invoke('lists:update', id, patch),
    remove: (id: string) => ipcRenderer.invoke('lists:delete', id)
  },
  folders: {
    create: (name: string) => ipcRenderer.invoke('folders:create', name)
  },
  tags: {
    create: (name: string, color?: string) => ipcRenderer.invoke('tags:create', name, color),
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
    openBackups: () => ipcRenderer.invoke('data:openBackups'),
    getLoginItem: () => ipcRenderer.invoke('app:getLoginItem'),
    setLoginItem: (enabled: boolean) => ipcRenderer.invoke('app:setLoginItem', enabled)
  },
  onQuickAdd: (cb: () => void) => {
    const listener = (): void => cb()
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
