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
import { checkpoint, clearCompleted, closeDb, getAllData, getDataDir, initDb } from './db'
import { removeDatabaseSidecars, swapDatabaseFile, validateDatabaseFile, type DatabaseSwap } from './db-file'
import { buildIcs, buildTaskCsv } from './export'
import { importFromText } from './import'
import { buildMarkdown } from './markdown'
import { notifyTaskWindows } from './pet'

function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function dayStamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
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
  return buildMarkdown(getAllData())
}

export function registerDataIpc(): void {
  ipcMain.handle('data:backup', () => {
    const p = backupNow('manual')
    return { ok: !!p, path: p }
  })
  ipcMain.handle('data:backups', () => backupList())
  ipcMain.handle('data:clearCompleted', () => clearCompleted())
  ipcMain.handle('data:restoreBackup', (_e, name: string) => {
    const dataDir = getDataDir()
    const tmp = join(dataDir, 'lighttodo.db.restore-tmp')
    let closed = false
    let swap: DatabaseSwap | null = null
    try {
      const safe = basename(name)
      const src = join(dataDir, 'backups', safe)
      // 先校验源备份，再复制到 staged 文件二次校验；任何一步失败都不碰正式库。
      const sourceCheck = validateDatabaseFile(src)
      if (!sourceCheck.ok) return { ok: false, message: sourceCheck.message }
      copyFileSync(src, tmp)
      const stagedCheck = validateDatabaseFile(tmp)
      if (!stagedCheck.ok) return { ok: false, message: stagedCheck.message }

      const preRestore = backupNow('pre-restore')
      if (!preRestore) return { ok: false, message: '无法创建恢复前备份，已取消恢复' }

      const dest = join(dataDir, 'lighttodo.db')
      closeDb()
      closed = true
      removeDatabaseSidecars(dest)
      swap = swapDatabaseFile(tmp, dest)
      // 新库要能完成迁移并打开，才算恢复成功；否则回滚到恢复前文件。
      initDb(dataDir)
      closed = false
      swap.commit()
      swap = null

      const launcher = join(process.execPath, '..', 'LightTodo.exe')
      if (process.platform === 'darwin') {
        // macOS 的 .app 由系统管理 bundle；交给 Electron 用当前可执行文件重启。
        app.relaunch()
      } else {
        // 开发模式下 Electron 需要显式带上应用目录和启动参数，否则重启后只会打开空 Electron。
        app.relaunch(app.isPackaged
          ? { execPath: existsSync(launcher) ? launcher : process.execPath }
          : { execPath: process.execPath, args: process.argv.slice(1) })
      }
      app.exit(0)
      return { ok: true }
    } catch (e) {
      if (swap) {
        try {
          closeDb()
          swap.rollback()
          initDb(dataDir)
          closed = false
        } catch (rollbackError) {
          return {
            ok: false,
            message: `恢复失败且回滚失败：${e instanceof Error ? e.message : String(e)}；${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
          }
        }
      } else if (closed) {
        try {
          initDb(dataDir)
          closed = false
        } catch {
          /* reported below */
        }
      }
      return { ok: false, message: `恢复失败：${e instanceof Error ? e.message : String(e)}` }
    } finally {
      try {
        if (existsSync(tmp)) unlinkSync(tmp)
      } catch {
        /* best effort */
      }
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
  ipcMain.handle('data:exportCsv', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出 CSV',
      defaultPath: join(app.getPath('documents'), `轻单任务-${dayStamp()}.csv`),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (canceled || !filePath) return { ok: false }
    try {
      const data = getAllData()
      writeFileSync(filePath, buildTaskCsv(data.tasks, data.lists), 'utf8')
      return { ok: true, path: filePath }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('data:exportIcs', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出 ICS',
      defaultPath: join(app.getPath('documents'), `轻单日历-${dayStamp()}.ics`),
      filters: [{ name: 'iCalendar', extensions: ['ics'] }]
    })
    if (canceled || !filePath) return { ok: false }
    try {
      const data = getAllData()
      writeFileSync(filePath, buildIcs(data.tasks), 'utf8')
      return { ok: true, path: filePath }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
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
    const result = importFromText(readFileSync(path, 'utf8'), basename(path))
    notifyTaskWindows()
    return result
  })
  // macOS/Linux 使用 Electron 登录项；Windows 另写 HKCU Run 作为双保险。
  if (process.platform !== 'win32') {
    ipcMain.handle('app:getLoginItem', () => {
      try {
        return app.getLoginItemSettings().openAtLogin
      } catch {
        return false
      }
    })
    ipcMain.handle('app:setLoginItem', (_e, enabled: boolean) => {
      try {
        app.setLoginItemSettings({ openAtLogin: enabled })
      } catch {
        /* 受系统策略限制时返回实际状态 */
      }
      try {
        return app.getLoginItemSettings().openAtLogin
      } catch {
        return false
      }
    })
    return
  }

  // Windows 自启直接写 HKCU Run，避免 Electron API 的 path/args 匹配问题
  const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
  const launcher = join(process.execPath, '..', 'LightTodo.exe')
  const loginExe = app.isPackaged && existsSync(launcher) ? launcher : process.execPath
  const loginArgs = app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden']
  const loginCommand = (): string => {
    const appArg = app.isPackaged ? '' : ` "${app.getAppPath()}"`
    return `"${loginExe}"${appArg} --hidden`
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
      if (app.getLoginItemSettings({ path: loginExe, args: loginArgs }).openAtLogin) return true
    } catch {
      /* ignore */
    }
    return loginEnabled()
  })
  ipcMain.handle('app:setLoginItem', (_e, enabled: boolean) => {
    // 双保险：Electron 登录项 + HKCU Run（某些环境其中一个会被策略挡住）
    try {
      app.setLoginItemSettings({ openAtLogin: enabled, path: loginExe, args: loginArgs })
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
      viaElectron = app.getLoginItemSettings({ path: loginExe, args: loginArgs }).openAtLogin
    } catch {
      /* ignore */
    }
    return enabled ? viaElectron || loginEnabled() : viaElectron
  })
}
