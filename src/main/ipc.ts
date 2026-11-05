import { app, ipcMain, shell } from 'electron'
import * as db from './db'
import type { CreateTaskInput, UpdateTaskInput } from '../shared/types'
import { notifyTaskWindows } from './pet'
import { updateTaskbarBadge } from './badge'

export function registerIpc(): void {
  const mutate = <T>(sender: number, action: () => T): T => {
    const result = action()
    notifyTaskWindows(sender)
    updateTaskbarBadge()
    return result
  }
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    dataDir: db.getDataDir(),
    platform: process.platform,
    theme: db.getSetting('ui_theme') ?? 'system'
  }))
  ipcMain.handle('app:openDataDir', async () => {
    await shell.openPath(db.getDataDir())
  })
  ipcMain.handle('app:openExternal', async (_event, url: string) => {
    if (!/^https?:\/\//i.test(url)) return false
    await shell.openExternal(url)
    return true
  })

  ipcMain.handle('sidebar:get', () => db.getSidebar())
  ipcMain.handle('review:get', () => db.getWeeklyReview())

  ipcMain.handle('tasks:list', (_e, opts: Parameters<typeof db.listTasks>[0]) => db.listTasks(opts))
  ipcMain.handle('tasks:get', (_e, id: string) => db.getTask(id))
  ipcMain.handle('tasks:create', (e, input: CreateTaskInput) => mutate(e.sender.id, () => db.createTask(input)))
  ipcMain.handle('tasks:update', (e, id: string, patch: UpdateTaskInput) => mutate(e.sender.id, () => db.updateTask(id, patch)))
  ipcMain.handle('tasks:setStatus', (e, id: string, done: boolean) => mutate(e.sender.id, () => db.setTaskStatus(id, done)))
  ipcMain.handle('tasks:delete', (e, id: string) => mutate(e.sender.id, () => db.deleteTask(id)))
  ipcMain.handle('tasks:restore', (e, id: string) => mutate(e.sender.id, () => db.restoreTask(id)))
  ipcMain.handle('tasks:purge', (e, id: string) => mutate(e.sender.id, () => db.purgeTask(id)))
  ipcMain.handle('tasks:reorder', (_e, items: { id: string; sortOrder: number }[]) =>
    mutate(_e.sender.id, () => db.reorderTasks(items))
  )

  ipcMain.handle('lists:create', (_e, input: Parameters<typeof db.createList>[0]) =>
    db.createList(input)
  )
  ipcMain.handle('lists:update', (_e, id: string, patch: Parameters<typeof db.updateList>[1]) =>
    mutate(_e.sender.id, () => db.updateList(id, patch))
  )
  ipcMain.handle('lists:delete', (e, id: string) => mutate(e.sender.id, () => db.deleteList(id)))

  ipcMain.handle('folders:create', (_e, name: string) => db.createFolder(name))
  ipcMain.handle('folders:update', (_e, id: string, patch: { name: string }) =>
    db.updateFolder(id, patch.name)
  )
  ipcMain.handle('folders:delete', (e, id: string) => mutate(e.sender.id, () => db.deleteFolder(id)))

  ipcMain.handle('tags:create', (_e, name: string, color?: string) => db.createTag(name, color))
  ipcMain.handle('tags:update', (_e, id: string, patch: { name?: string; color?: string | null }) =>
    db.updateTag(id, patch)
  )
  ipcMain.handle('tags:delete', (_e, id: string) => db.deleteTag(id))

  ipcMain.handle('search:query', (_e, q: string) => db.searchTasks(q))

  ipcMain.handle('settings:get', (_e, key: string) => db.getSetting(key))
  ipcMain.handle('settings:set', (_e, key: string, value: string) => db.setSetting(key, value))
}
