import { app, dialog, ipcMain, shell } from 'electron'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { checkpoint, clearCompleted, closeDb, getAllData, getDataDir } from './db'
import { importFromText } from './import'

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
  ipcMain.handle('data:clearCompleted', () => clearCompleted())
  ipcMain.handle('data:restoreBackup', (_e, name: string) => {
    try {
      const safe = basename(name)
      const src = join(getDataDir(), 'backups', safe)
      if (!existsSync(src)) return { ok: false, message: '备份文件不存在' }
      closeDb()
      const dest = join(getDataDir(), 'lighttodo.db')
      copyFileSync(src, dest)
      for (const suffix of ['-wal', '-shm']) {
        const p = dest + suffix
        if (existsSync(p)) unlinkSync(p)
      }
      app.relaunch()
      app.exit(0)
      return { ok: true }
    } catch (e) {
      return { ok: false, message: String(e) }
    }
  })
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
  ipcMain.handle('data:import', async () => {
    const res = await dialog.showOpenDialog({
      title: '导入任务',
      properties: ['openFile'],
      filters: [
        { name: '轻单 JSON / CSV', extensions: ['json', 'csv'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (res.canceled || !res.filePaths.length) {
      return { ok: false, lists: 0, tasks: 0, tags: 0, errors: [], message: '已取消' }
    }
    const path = res.filePaths[0]
    return importFromText(readFileSync(path, 'utf8'), basename(path))
  })
  // Windows 自启直接写 HKCU Run，避免 Electron API 的 path/args 匹配问题
  const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
  const loginArgs = app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden']
  const loginCommand = (): string => {
    const appArg = app.isPackaged ? '' : ` "${app.getAppPath()}"`
    return `"${process.execPath}"${appArg} --hidden`
  }
  const loginEnabled = (): boolean => {
    try {
      const out = execFileSync('reg', ['query', RUN_KEY, '/v', 'LightTodo'], {
        encoding: 'utf8',
        windowsHide: true
      })
      return out.includes('LightTodo')
    } catch {
      return false
    }
  }
  ipcMain.handle('app:getLoginItem', () => {
    try {
      if (app.getLoginItemSettings({ path: process.execPath, args: loginArgs }).openAtLogin) return true
    } catch {
      /* ignore */
    }
    return loginEnabled()
  })
  ipcMain.handle('app:setLoginItem', (_e, enabled: boolean) => {
    // 双保险：Electron 登录项 + HKCU Run（某些环境其中一个会被策略挡住）
    try {
      app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: loginArgs })
    } catch {
      /* ignore */
    }
    try {
      if (enabled) {
        execFileSync(
          'reg',
          ['add', RUN_KEY, '/v', 'LightTodo', '/t', 'REG_SZ', '/d', loginCommand(), '/f'],
          { windowsHide: true }
        )
      } else {
        execFileSync('reg', ['delete', RUN_KEY, '/v', 'LightTodo', '/f'], { windowsHide: true })
      }
    } catch {
      /* 关闭时键不存在会抛错，忽略 */
    }
    let viaElectron = false
    try {
      viaElectron = app.getLoginItemSettings({ path: process.execPath, args: loginArgs }).openAtLogin
    } catch {
      /* ignore */
    }
    return enabled ? viaElectron || loginEnabled() : viaElectron
  })
}
