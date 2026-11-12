import { app, ipcMain, shell } from 'electron'
import * as db from './db'
import { syncIcsSubscription } from './calendar-sync'
import type { CreateTaskInput, UpdateTaskInput } from '../shared/types'
import { notifyTaskWindows } from './pet'
import { updateTaskbarBadge } from './badge'

function readText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空`)
  return value.trim()
}

function readDateBoundary(value: unknown, label: string): string {
  const raw = readText(value, label)
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : new Date(raw)
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label}格式无效`)
  return raw
}

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
  ipcMain.handle('review:day', (_e, date: string) => db.getDayReview(date))
  ipcMain.handle('review:saveDay', (_e, date: string, rating: number | null, note: string) =>
    db.saveDayReview(date, rating, note)
  )
  ipcMain.handle('review:dates', (_e, from: string, to: string) => db.getReviewedDates(from, to))
  ipcMain.handle('review:shouldPrompt', () => db.shouldPromptShutdown())

  ipcMain.handle('replan:list', () => db.listOverdueTasks())
  ipcMain.handle('replan:act', (e, id: string, action: db.ReplanAction, date?: string | null) =>
    mutate(e.sender.id, () => db.replanTask(id, action, date))
  )

  ipcMain.handle('sections:list', (_e, listId: string) => db.getSections(listId))
  ipcMain.handle('sections:create', (_e, listId: string, name: string) => db.createSection(listId, name))
  ipcMain.handle('sections:update', (_e, id: string, patch: Parameters<typeof db.updateSection>[1]) =>
    db.updateSection(id, patch)
  )
  ipcMain.handle('sections:delete', (e, id: string) => mutate(e.sender.id, () => db.deleteSection(id)))

  ipcMain.handle('filters:list', () => db.getSavedFilters())
  ipcMain.handle('filters:create', (_e, input: Parameters<typeof db.createSavedFilter>[0]) =>
    db.createSavedFilter(input)
  )
  ipcMain.handle('filters:update', (_e, id: string, patch: Parameters<typeof db.updateSavedFilter>[1]) =>
    db.updateSavedFilter(id, patch)
  )
  ipcMain.handle('filters:delete', (_e, id: string) => db.deleteSavedFilter(id))
  ipcMain.handle('filters:preview', (_e, query: Parameters<typeof db.countFilter>[0]) =>
    db.countFilter(query)
  )

  ipcMain.handle('tasks:addTime', (e, id: string, startedAt: string, endedAt: string) =>
    mutate(e.sender.id, () => db.addTimeEntry(id, startedAt, endedAt))
  )

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

  ipcMain.handle('calendar:syncIcs', async (_e, url: unknown) => {
    const cleanUrl = readText(url, '日历订阅地址')
    if (cleanUrl.length > 2048) throw new Error('日历订阅地址过长')
    return syncIcsSubscription(cleanUrl)
  })
  ipcMain.handle('calendar:getEvents', (_e, from: unknown, to: unknown) => {
    const fromDate = readDateBoundary(from, '开始日期')
    const toDate = readDateBoundary(to, '结束日期')
    return db.getCalendarEvents(fromDate, toDate)
  })
  ipcMain.handle('calendar:getSubscription', () => db.getCalendarSubscription())
  ipcMain.handle('calendar:clearIcs', () => db.clearCalendarSubscription())

  ipcMain.handle('settings:get', (_e, key: string) => db.getSetting(key))
  ipcMain.handle('settings:set', (_e, key: string, value: string) => db.setSetting(key, value))
}
