import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  Notification,
  nativeImage,
  globalShortcut,
  dialog,
  ipcMain,
  nativeTheme,
  screen
} from 'electron'
import { join } from 'node:path'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { release } from 'node:os'
import { initDb, closeDb, getDueReminders, getSetting, setSetting, markReminderSent, purgeTrash } from './db'
import { windowColors, type ThemePreference } from './window-theme'
import { registerIpc } from './ipc'
import { backupNow, registerDataIpc } from './data'
import { registerPet, schedulePetCreation, stopPet, togglePet } from './pet'

const T0 = Date.now()
const isDev = !app.isPackaged
const launcherPath = app.isPackaged && existsSync(join(process.execPath, '..', 'LightTodo.exe'))
  ? join(process.execPath, '..', 'LightTodo.exe') : process.execPath

// 便携版把数据放在 exe 同目录；开发环境放工作区；也可用环境变量显式指定。
const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR
  ? join(process.env.PORTABLE_EXECUTABLE_DIR, 'LightTodoData')
  : null
const dataRootOverride =
  process.env.LIGHTTODO_DATA_DIR ??
  portableRoot ??
  (isDev ? join(app.getAppPath(), '.data') : null)
if (dataRootOverride) {
  mkdirSync(join(dataRootOverride, 'userdata'), { recursive: true })
  app.setPath('userData', join(dataRootOverride, 'userdata'))
}
const logFile = join(app.getPath('userData'), 'startup.log')
function log(message: string): void {
  try { appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`) } catch { /* best effort */ }
}
log(`Starting ${app.getVersion()} ${process.execPath}`)
process.on('uncaughtException', error => { log(error.stack ?? String(error)); dialog.showErrorBox('轻单运行错误', `${error.message}\n\n日志：${logFile}`) })
process.on('unhandledRejection', error => log(`Unhandled rejection: ${String(error)}`))

const win11 = process.platform === 'win32' && Number(release().split('.')[2] ?? 0) >= 22000
const shotArg = process.argv.find((a) => a.startsWith('--screenshot'))
const shotPath = shotArg?.includes('=') ? shotArg.split('=')[1] : process.env.LIGHTTODO_SHOT
const qaArg = process.argv.find((a) => a.startsWith('--qa='))?.split('=')[1]
const e2eArg = process.argv.find((a) => a.startsWith('--e2e='))?.split('=')[1]

const ownsInstance = app.requestSingleInstanceLock()
if (!ownsInstance) {
  log('Forwarded to existing instance')
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let appliedWindowColors = windowColors(nativeTheme.shouldUseDarkColors)

function syncWindowTheme(): ReturnType<typeof windowColors> {
  const colors = windowColors(nativeTheme.shouldUseDarkColors)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(colors.color)
    if (process.platform === 'win32') mainWindow.setTitleBarOverlay({ ...colors, height: 40 })
    appliedWindowColors = colors
  }
  return colors
}
nativeTheme.on('updated', syncWindowTheme)

function resolveDataDir(): string {
  if (process.env.LIGHTTODO_DATA_DIR) return process.env.LIGHTTODO_DATA_DIR
  if (portableRoot) return portableRoot
  if (!app.isPackaged) return join(app.getAppPath(), '.data')
  return app.getPath('userData')
}

function iconPath(): string {
  const candidates = [
    join(app.getAppPath(), 'build', 'icon.png'),
    join(process.resourcesPath, 'icon.png')
  ]
  return candidates.find((p) => existsSync(p)) ?? ''
}

function showMain(): void {
  if (isQuitting) return
  if (!app.isReady()) { app.once('ready', showMain); return }
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  // Windows 会阻止后台进程抢前台：临时置顶再取消，确保窗口真的到最前
  mainWindow.setAlwaysOnTop(true)
  mainWindow.focus()
  mainWindow.moveTop()
  mainWindow.setAlwaysOnTop(false)
}

function createWindow(): void {
  const display = screen.getPrimaryDisplay()
  const width = Math.min(1280, Math.round(display.workAreaSize.width * 0.78))
  const height = Math.min(820, Math.round(display.workAreaSize.height * 0.82))

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 720,
    minHeight: 520,
    show: false,
    title: '轻单',
    titleBarStyle: 'hidden',
    ...(process.platform === 'win32'
      ? {
          titleBarOverlay: {
            ...windowColors(nativeTheme.shouldUseDarkColors),
            height: 40
          },
          ...(win11 ? { backgroundMaterial: 'mica' as const } : {})
        }
      : {}),
    backgroundColor: windowColors(nativeTheme.shouldUseDarkColors).color,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      app.quit()
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
    if (!isQuitting) app.quit()
  })
  mainWindow.webContents.on('destroyed', () => {
    if (!isQuitting) app.quit()
  })

  mainWindow.once('ready-to-show', () => {
    const coldStartMs = Date.now() - T0
    log('Window ready')
    log(`COLD_START_MS ${coldStartMs}`)
    console.log('COLD_START_MS', coldStartMs)
    // 主窗口可用后再安排桌宠，默认关闭时这里直接跳过；老用户约 8 秒后创建。
    schedulePetCreation()
    // 回收站 30 天清理放到首屏之后，避免挡住冷启动路径。
    setTimeout(() => {
      try {
        purgeTrash()
      } catch (error) {
        log(`purgeTrash failed: ${String(error)}`)
      }
    }, 1500)
    const hiddenStart = process.argv.includes('--hidden') && !e2eArg && !shotPath
    if (!hiddenStart) mainWindow?.show()
    if (process.argv.includes('--quick-add')) {
      setTimeout(() => sendToRenderer('ui:quick-add', ''), 700)
    }
    if (e2eArg) {
      setTimeout(() => runE2E(mainWindow!, e2eArg), 1200)
      return
    }
    if (shotPath) {
      setTimeout(async () => {
        try {
          if (qaArg) await runQa(mainWindow!, qaArg)
          const image = await mainWindow!.webContents.capturePage()
          writeFileSync(shotPath, image.toPNG())
          console.log('SCREENSHOT_SAVED', shotPath)
        } catch (err) {
          console.error('SCREENSHOT_FAILED', err)
        } finally {
          isQuitting = true
          app.quit()
        }
      }, 1600)
    }
  })
  mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
    log(`Load failed ${code}: ${description}`)
    mainWindow?.show()
    dialog.showErrorBox('轻单页面加载失败', `${description}\n请重新解压完整程序目录后启动。\n日志：${logFile}`)
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log(`Renderer exited: ${details.reason}`)
    app.quit()
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function sendToRenderer(channel: string, ...args: unknown[]): void {
  mainWindow?.webContents.send(channel, ...args)
}

function sendToRendererWhenReady(channel: string, ...args: unknown[]): void {
  const win = mainWindow
  if (!win) return
  const send = (): void => {
    setTimeout(() => win.webContents.send(channel, ...args), 400)
  }
  if (win.webContents.isLoadingMainFrame()) {
    win.webContents.once('did-finish-load', send)
  } else {
    send()
  }
}

function quickAdd(): void {
  showMain()
  sendToRenderer('ui:quick-add')
}

async function runQa(win: BrowserWindow, mode: string): Promise<void> {
  const fillQuick = `(() => {
    const i = document.querySelector('.qa-input');
    if (!i) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(i, '明天下午3点 交周报 #工作 @汇报 !高');
    i.dispatchEvent(new Event('input', { bubbles: true }));
  })()`
  const scripts: Record<string, string> = {
    quickadd: `(() => { const b = document.querySelector('.new-task'); if (!b) return 'NO_BUTTON'; b.click(); return 'CLICKED'; })()`,
    quickaddtext: `document.querySelector('.new-task')?.click(); setTimeout(${JSON.stringify(fillQuick)}, 300)`,
    create: `document.querySelector('.new-task')?.click(); setTimeout(() => { ${fillQuick}; setTimeout(() => { document.querySelector('.qa-submit')?.click() }, 250) }, 300)`,
    detail: `document.querySelector('.task-row')?.click()`,
    upcoming: `[...document.querySelectorAll('.nav-item')].find((el) => el.textContent?.includes('最近 7 天'))?.click()`,
    complete: `document.querySelector('.task-row .check')?.click()`,
    settings: `document.querySelector('.sb-foot .nav-item')?.click()`,
    calendar: `[...document.querySelectorAll('.nav-item')].find((el) => el.textContent?.includes('日历'))?.click()`,
    all: `[...document.querySelectorAll('.nav-item')].find((el) => el.textContent?.trim().startsWith('全部'))?.click()`,
    towork: `[...document.querySelectorAll('.list-item')].find((el) => el.textContent?.includes('工作'))?.click()`,
    addwork: `(() => {
      const btn = [...document.querySelectorAll('.list-item')].find((el) => el.textContent?.includes('工作'));
      if (!btn) return 'NO_LIST';
      btn.click();
      setTimeout(() => {
        document.querySelector('.new-task')?.click();
        setTimeout(() => {
          const i = document.querySelector('.qa-input');
          if (!i) return 'NO_INPUT';
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          setter.call(i, '工作清单验证任务');
          i.dispatchEvent(new Event('input', { bubbles: true }));
          setTimeout(() => { document.querySelector('.qa-submit')?.click(); }, 200);
        }, 300);
      }, 300);
      return 'OK';
    })()`,
    search: `document.querySelector('.titlebar-search')?.click()`,
    searchquery: `document.querySelector('.titlebar-search')?.click(); setTimeout(() => {
      const i = document.querySelector('.search-input-row input');
      if (!i) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, '周报');
      i.dispatchEvent(new Event('input', { bubbles: true }));
    }, 300)`
  }
  const ret = await win.webContents.executeJavaScript(scripts[mode] ?? '')
  console.log('QA_EXEC', mode, JSON.stringify(ret))
  await new Promise((r) => setTimeout(r, 1100))
  const diag = await win.webContents.executeJavaScript(
    `({ overlay: document.querySelectorAll('.overlay').length, qa: !!document.querySelector('.qa'), rows: document.querySelectorAll('.task-row').length, detail: !!document.querySelector('.detail-title') })`
  )
  console.log('QA_DIAG', mode, JSON.stringify(diag))
}

async function runE2E(win: BrowserWindow, file: string): Promise<void> {
  const out = file.replace(/\.json$/, '.out.json')
  const results: unknown[] = []
  try {
    const spec = JSON.parse(readFileSync(file, 'utf8')) as {
      steps: { js?: string; wait?: number; shot?: string; size?: [number, number]; nativeThemeSource?: ThemePreference; inspectWindow?: boolean }[]
    }
    for (const step of spec.steps) {
      if (step.size) { win.setSize(...step.size); await new Promise(r => setTimeout(r, 250)) }
      // These controls are only available to the existing --e2e test runner.
      if (step.nativeThemeSource) { nativeTheme.themeSource = step.nativeThemeSource; await new Promise(r => setTimeout(r, 250)) }
      if (step.inspectWindow) results.push({ size: win.getSize(), overlay: appliedWindowColors })
      if (step.shot) {
        const image = await win.webContents.capturePage()
        writeFileSync(step.shot, image.toPNG())
        results.push({ shot: step.shot })
      }
      if (step.js) {
        const r = await win.webContents.executeJavaScript(step.js)
        results.push(r)
      }
      await new Promise((r) => setTimeout(r, step.wait ?? 350))
    }
    writeFileSync(out, JSON.stringify({ ok: true, results }, null, 2))
  } catch (e) {
    writeFileSync(out, JSON.stringify({ ok: false, error: String(e), results }, null, 2))
  } finally {
    isQuitting = true
    app.quit()
  }
}

function createTray(): void {
  const p = iconPath()
  if (!p) {
    console.warn('TRAY_ICON_MISSING')
    return
  }
  const image = nativeImage.createFromPath(p).resize({ width: 16, height: 16 })
  tray = new Tray(image)
  tray.setToolTip('轻单 LightTodo')
  const menu = Menu.buildFromTemplate([
    { label: '打开轻单', click: showMain },
    { label: '新建任务', accelerator: 'CommandOrControl+Shift+Space', click: quickAdd },
    { label: '显示 / 隐藏桌面伙伴', click: togglePet },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
  tray.on('click', showMain)
}

function startReminderLoop(): void {
  const tick = (): void => {
    try {
      if (getSetting('reminders_enabled') === '0') return
    } catch {
      /* ignore */
    }
    let due: ReturnType<typeof getDueReminders>
    try {
      due = getDueReminders(new Date().toISOString())
    } catch (e) {
      console.error('reminder query failed', e)
      return
    }
    if (!due.length) return
    const supported = Notification.isSupported()
    for (const task of due.slice(0, 3)) {
      if (supported) {
        const n = new Notification({
          title: '轻单 · 提醒',
          body: task.title,
          silent: false
        })
        n.on('click', () => {
          showMain()
          sendToRenderer('ui:open-task', task.id)
        })
        n.show()
      }
      markReminderSent(task.id)
    }
    if (due.length > 3) {
      if (supported) {
        new Notification({
          title: '轻单',
          body: `还有 ${due.length - 3} 条提醒，打开应用查看`
        }).show()
      }
      for (const task of due.slice(3)) markReminderSent(task.id)
    }
  }
  setTimeout(tick, 3000)
  setInterval(tick, 30000)
}

function registerShortcuts(): void {
  const ok = globalShortcut.register('CommandOrControl+Shift+Space', quickAdd)
  if (!ok) console.warn('GLOBAL_SHORTCUT_FAILED')
}

function handleProtocolUrl(url: string): void {
  console.log('PROTOCOL_URL', url)
  try {
    const u = new URL(url)
    if (u.protocol !== 'lighttodo:') return
    showMain()
    const text = u.searchParams.get('text') ?? ''
    if (u.hostname === 'add') {
      sendToRendererWhenReady('ui:quick-add', text)
    }
  } catch (e) {
    console.warn('PROTOCOL_PARSE_FAILED', url, e)
  }
}

function setupIntegration(): void {
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('lighttodo', process.execPath, [process.argv[1]])
    } else {
      app.setAsDefaultProtocolClient('lighttodo', launcherPath)
    }
  } catch (e) {
    console.warn('PROTOCOL_REGISTER_FAILED', e)
  }

  if (app.isPackaged) {
    try {
      app.setJumpList([
        {
          type: 'tasks',
          items: [
            { type: 'task', title: '新建任务', program: launcherPath, args: '--quick-add' }
          ]
        }
      ])
    } catch (e) {
      console.warn('JUMPLIST_FAILED', e)
    }
  }

  const startupUrl = process.argv.find((a) => a.startsWith('lighttodo://'))
  console.log('STARTUP_ARGV', JSON.stringify(process.argv))
  if (startupUrl) {
    console.log('STARTUP_URL', startupUrl)
    setTimeout(() => handleProtocolUrl(startupUrl), 1500)
  }
}

if (ownsInstance) app.whenReady().then(() => {
  app.setAppUserModelId('com.lighttodo.app')
  initDb(resolveDataDir())
  // Trash cleanup is not needed before the first paint; defer it so the
  // window can become visible without waiting for two extra writes.
  const savedTheme = getSetting('ui_theme')
  nativeTheme.themeSource = savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'system'
  ipcMain.handle('app:setTheme', (_event, theme: ThemePreference) => {
    if (!['system', 'light', 'dark'].includes(theme)) throw new Error('无效主题')
    nativeTheme.themeSource = theme
    setSetting('ui_theme', theme)
    return { ...syncWindowTheme(), dark: nativeTheme.shouldUseDarkColors }
  })
  registerIpc()
  registerDataIpc()
  createWindow()
  registerPet((id, settings) => {
    showMain()
    if (id) sendToRendererWhenReady('ui:open-task', id)
    if (settings) sendToRendererWhenReady('ui:settings')
  }, T0)
  createTray()
  registerShortcuts()
  setupIntegration()
  startReminderLoop()
  // 备份放到窗口显示之后，不阻塞冷启动
  setTimeout(() => backupNow('startup'), 3000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showMain()
  })
}).catch(error => {
  log(`Startup failed: ${error.stack ?? String(error)}`)
  dialog.showErrorBox('轻单启动失败', `${String(error)}\n\n数据目录：${resolveDataDir()}\n日志：${logFile}`)
  app.quit()
})

app.on('second-instance', (_e, argv) => {
  const url = argv.find((a) => a.startsWith('lighttodo://'))
  if (url) {
    handleProtocolUrl(url)
    return
  }
  if (argv.includes('--quick-add')) {
    quickAdd()
    return
  }
  if (argv.includes('--hidden')) return
  showMain()
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', () => {
  isQuitting = true
  stopPet()
  globalShortcut.unregisterAll()
  backupNow('exit')
  closeDb()
})
