import { app, dialog, ipcMain, shell } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkpoint, getAllData, getDataDir } from './db'

function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function backupNow(reason = 'manual'): string | null {
  try {
    checkpoint()
    const dir = join(getDataDir(), 'backups')
    mkdirSync(dir, { recursive: true })
    const src = join(getDataDir(), 'lighttodo.db')
    if (!existsSync(src)) return null
    const dest = join(dir, `lighttodo-${stamp()}-${reason}.db`)
    copyFileSync(src, dest)
    pruneBackups(dir, 14)
    return dest
  } catch (e) {
    console.error('backup failed', e)
    return null
  }
}

function pruneBackups(dir: string, keep: number): void {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith('lighttodo-') && f.endsWith('.db'))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  for (const item of files.slice(keep)) {
    try {
      unlinkSync(join(dir, item.f))
    } catch {
      /* ignore */
    }
  }
}

function backupList(): { name: string; size: number; time: number }[] {
  const dir = join(getDataDir(), 'backups')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => ({
      name: f,
      size: statSync(join(dir, f)).size,
      time: statSync(join(dir, f)).mtimeMs
    }))
    .sort((a, b) => b.time - a.time)
}

function markdown(): string {
  const data = getAllData()
  const lines: string[] = [`# 轻单导出 ${new Date().toLocaleString('zh-CN')}`, '']
  const byList = new Map<string, typeof data.tasks>()
  for (const t of data.tasks) {
    if (t.parentId) continue
    const key = t.listId ?? ''
    if (!byList.has(key)) byList.set(key, [])
    byList.get(key)!.push(t)
  }
  const listName = (id: string): string => data.lists.find((l) => l.id === id)?.name ?? '收件箱'
  for (const [listId, tasks] of byList) {
    lines.push(`## ${listId ? listName(listId) : '收件箱'}`, '')
    for (const t of tasks) {
      const done = t.status === 1 ? 'x' : ' '
      const bits: string[] = []
      if (t.scheduledDate) bits.push(`计划 ${t.scheduledDate}`)
      if (t.dueAt) bits.push(`截止 ${new Date(t.dueAt).toLocaleString('zh-CN')}`)
      if (t.priority === 3) bits.push('!高')
      else if (t.priority === 2) bits.push('!中')
      else if (t.priority === 1) bits.push('!低')
      if (t.tags.length) bits.push(t.tags.map((x) => `#${x.name}`).join(' '))
      lines.push(`- [${done}] ${t.title}${bits.length ? `  _(${bits.join(' · ')})_` : ''}`)
      for (const sub of t.subtasks ?? []) {
        lines.push(`  - [${sub.status === 1 ? 'x' : ' '}] ${sub.title}`)
      }
    }
    lines.push('')
  }
  return lines.join('\n')
}

export function registerDataIpc(): void {
  ipcMain.handle('data:backup', () => {
    const p = backupNow('manual')
    return { ok: !!p, path: p }
  })
  ipcMain.handle('data:backups', () => backupList())
  ipcMain.handle('data:exportJson', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出 JSON',
      defaultPath: join(app.getPath('documents'), `lighttodo-${stamp()}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (canceled || !filePath) return { ok: false }
    writeFileSync(filePath, JSON.stringify(getAllData(), null, 2), 'utf8')
    return { ok: true, path: filePath }
  })
  ipcMain.handle('data:exportMarkdown', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出 Markdown',
      defaultPath: join(app.getPath('documents'), `lighttodo-${stamp()}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (canceled || !filePath) return { ok: false }
    writeFileSync(filePath, markdown(), 'utf8')
    return { ok: true, path: filePath }
  })
  ipcMain.handle('data:openBackups', async () => {
    const dir = join(getDataDir(), 'backups')
    mkdirSync(dir, { recursive: true })
    await shell.openPath(dir)
  })
  ipcMain.handle('app:getLoginItem', () => app.getLoginItemSettings().openAtLogin)
  ipcMain.handle('app:setLoginItem', (_e, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
    return app.getLoginItemSettings().openAtLogin
  })
}
