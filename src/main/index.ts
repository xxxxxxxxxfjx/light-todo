import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  Notification,
  nativeImage,
  globalShortcut,
  screen
} from 'electron'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { release } from 'node:os'
import { initDb, closeDb, getDueReminders, getSetting, markReminderSent } from './db'
import { registerIpc } from './ipc'
import { backupNow, registerDataIpc } from './data'

const T0 = Date.now()
const isDev = !app.isPackaged

// 便携版把数据放在 exe 同目录；开发环境放工作区；也可用环境变量显式指定。
const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR
  ? join(process.env.PORTABLE_EXECUTABLE_DIR, 'LightTodoData')
  : null
const dataRootOverride =
  process.env.LIGHTTODO_DATA_DIR ??
  portableRoot ??
  (isDev ? join(app.getAppPath(), '.data') : null)
if (dataRootOverride) {
  app.setPath('userData', join(dataRootOverride, 'userdata'))
}

const win11 = process.platform === 'win32' && Number(release().split('.')[2] ?? 0) >= 22000
const shotArg = process.argv.find((a) => a.startsWith('--screenshot'))
const shotPath = shotArg?.includes('=') ? shotArg.split('=')[1] : process.env.LIGHTTODO_SHOT
const qaArg = process.argv.find((a) => a.startsWith('--qa='))?.split('=')[1]
const e2eArg = process.argv.find((a) => a.startsWith('--e2e='))?.split('=')[1]

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

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
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: '轻单',
    titleBarStyle: 'hidden',
    ...(process.platform === 'win32'
      ? {
          titleBarOverlay: {
            color: win11 ? '#00000000' : '#f3f3f5',
            symbolColor: '#3b3b41',
            height: 40
          },
          ...(win11 ? { backgroundMaterial: 'mica' as const } : {})
        }
      : {}),
    backgroundColor: '#f3f3f5',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('close', (e) => {
    if (!isQuitting && !shotPath) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.once('ready-to-show', () => {
    console.log('COLD_START_MS', Date.now() - T0)
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
      steps: { js?: string; wait?: number; shot?: string }[]
    }
    for (const step of spec.steps) {
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
      app.setAsDefaultProtocolClient('lighttodo')
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
            { type: 'task', title: '新建任务', program: process.execPath, args: '--quick-add' }
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

app.whenReady().then(() => {
  app.setAppUserModelId('com.lighttodo.app')
  initDb(resolveDataDir())
  registerIpc()
  registerDataIpc()
  createWindow()
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
})

app.on('second-instance', (_e, argv) => {
  const url = argv.find((a) => a.startsWith('lighttodo://'))
  if (url) handleProtocolUrl(url)
  else showMain()
})

app.on('window-all-closed', () => {
  // Tray app: keep running until explicit quit.
})

app.on('before-quit', () => {
  isQuitting = true
  globalShortcut.unregisterAll()
  backupNow('exit')
  closeDb()
})
