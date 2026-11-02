import { app, BrowserWindow, Menu, Tray, nativeImage, globalShortcut, screen } from 'electron'
import { join } from 'node:path'
import { existsSync, writeFileSync } from 'node:fs'
import { release } from 'node:os'
import { initDb, closeDb } from './db'
import { registerIpc } from './ipc'

const isDev = !app.isPackaged

// 开发环境把 Chromium 的 userData 也放进工作区，避免写到系统目录。
if (isDev) {
  const devRoot = process.env.LIGHTTODO_DATA_DIR ?? join(app.getAppPath(), '.data')
  app.setPath('userData', join(devRoot, 'userdata'))
}

const win11 = process.platform === 'win32' && Number(release().split('.')[2] ?? 0) >= 22000
const shotArg = process.argv.find((a) => a.startsWith('--screenshot'))
const shotPath = shotArg?.includes('=') ? shotArg.split('=')[1] : process.env.LIGHTTODO_SHOT
const qaArg = process.argv.find((a) => a.startsWith('--qa='))?.split('=')[1]

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

function resolveDataDir(): string {
  if (process.env.LIGHTTODO_DATA_DIR) return process.env.LIGHTTODO_DATA_DIR
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
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
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
    mainWindow?.show()
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

function registerShortcuts(): void {
  const ok = globalShortcut.register('CommandOrControl+Shift+Space', quickAdd)
  if (!ok) console.warn('GLOBAL_SHORTCUT_FAILED')
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.lighttodo.app')
  initDb(resolveDataDir())
  registerIpc()
  createWindow()
  createTray()
  registerShortcuts()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showMain()
  })
})

app.on('second-instance', () => showMain())

app.on('window-all-closed', () => {
  // Tray app: keep running until explicit quit.
})

app.on('before-quit', () => {
  isQuitting = true
  globalShortcut.unregisterAll()
  closeDb()
})
