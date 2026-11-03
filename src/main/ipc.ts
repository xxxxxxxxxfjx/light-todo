import { app, ipcMain, shell } from 'electron'
import * as db from './db'
import type { CreateTaskInput, UpdateTaskInput } from '../shared/types'

export function registerIpc(): void {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    dataDir: db.getDataDir(),
    platform: process.platform
  }))
  ipcMain.handle('app:openDataDir', async () => {
    await shell.openPath(db.getDataDir())
  })

  ipcMain.handle('sidebar:get', () => db.getSidebar())

  ipcMain.handle('tasks:list', (_e, opts: Parameters<typeof db.listTasks>[0]) => db.listTasks(opts))
  ipcMain.handle('tasks:get', (_e, id: string) => db.getTask(id))
  ipcMain.handle('tasks:create', (_e, input: CreateTaskInput) => db.createTask(input))
  ipcMain.handle('tasks:update', (_e, id: string, patch: UpdateTaskInput) => db.updateTask(id, patch))
  ipcMain.handle('tasks:setStatus', (_e, id: string, done: boolean) => db.setTaskStatus(id, done))
  ipcMain.handle('tasks:delete', (_e, id: string) => db.deleteTask(id))
  ipcMain.handle('tasks:restore', (_e, id: string) => db.restoreTask(id))
  ipcMain.handle('tasks:purge', (_e, id: string) => db.purgeTask(id))
  ipcMain.handle('tasks:reorder', (_e, items: { id: string; sortOrder: number }[]) =>
    db.reorderTasks(items)
  )

  ipcMain.handle('lists:create', (_e, input: Parameters<typeof db.createList>[0]) =>
    db.createList(input)
  )
  ipcMain.handle('lists:update', (_e, id: string, patch: Parameters<typeof db.updateList>[1]) =>
    db.updateList(id, patch)
  )
  ipcMain.handle('lists:delete', (_e, id: string) => db.deleteList(id))

  ipcMain.handle('folders:create', (_e, name: string) => db.createFolder(name))

  ipcMain.handle('tags:create', (_e, name: string, color?: string) => db.createTag(name, color))
  ipcMain.handle('tags:update', (_e, id: string, patch: { name?: string; color?: string | null }) =>
    db.updateTag(id, patch)
  )
  ipcMain.handle('tags:delete', (_e, id: string) => db.deleteTag(id))

  ipcMain.handle('search:query', (_e, q: string) => db.searchTasks(q))

  ipcMain.handle('settings:get', (_e, key: string) => db.getSetting(key))
  ipcMain.handle('settings:set', (_e, key: string, value: string) => db.setSetting(key, value))
}
