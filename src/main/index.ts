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
  screen,
  clipboard,
  ClipboardItem
} from 'electron'
import { join } from 'node:path'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { release } from 'node:os'
import { initDb, closeDb, getDueReminders, getSetting, setSetting, markReminderSent, purgeTrash, setTaskStatus, snoozeReminder } from './db'
import { buildTaskToastXml, parseReminderProtocol } from './reminder'
import { windowColors, type ThemePreference } from './window-theme'
import { registerIpc } from './ipc'
import { backupNow, registerDataIpc } from './data'
import { registerPet, schedulePetCreation, stopPet, togglePet, notifyTaskWindows } from './pet'
import { registerIsland, stopIsland, toggleIsland, notifyIsland } from './island'
import { ocrImageBuffer, closeOcrEngine } from './ocr'
import { captureScreenRegion } from './capture'
import { migrateLegacyDatabase } from './data-migrate'
import { updateTaskbarBadge } from './badge'
import type { ShortcutInfo, ShortcutKind, Task } from '../shared/types'

const T0 = Date.now()
const isDev = !app.isPackaged
const launcherPath = process.env.PORTABLE_EXECUTABLE_FILE && existsSync(process.env.PORTABLE_EXECUTABLE_FILE)
  ? process.env.PORTABLE_EXECUTABLE_FILE
  : app.isPackaged && existsSync(join(process.execPath, '..', 'LightTodo.exe'))
  ? join(process.execPath, '..', 'LightTodo.exe') : process.execPath

// 便携版把数据放在 exe 同目录；开发环境放工作区；也可用环境变量显式指定。
const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR
  ? join(process.env.PORTABLE_EXECUTABLE_DIR, 'LightTodoData')
  : null
const dataRootOverride =
  process.env.LIGHTTODO_DATA_DIR ??
  portableRoot ??
  (isDev ? join(app.getAppPath(), '.tmp', 'data') : null)
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
  if (!app.isPackaged) return join(app.getAppPath(), '.tmp', 'data')
  return app.getPath('userData')
}

function iconPath(): string {
  const candidates = [
    join(app.getAppPath(), 'build', 'icon.png'),
    join(process.resourcesPath, 'icon.png')
  ]
  return candidates.find((p) => existsSync(p)) ?? ''
}

function windowIconPath(): string {
  const candidates = [
    join(process.resourcesPath, 'icon.ico'),
    join(app.getAppPath(), 'build', 'icon.ico'),
    join(process.resourcesPath, 'icon.png'),
    join(app.getAppPath(), 'build', 'icon.png')
  ]
  return candidates.find((p) => existsSync(p)) ?? ''
}

function trayIconPath(): string {
  const candidates = [
    join(app.getAppPath(), 'build', 'tray.png'),
    join(process.resourcesPath, 'tray.png'),
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
  // 从任务岛/托盘唤起时，后台进程直接 focus 会被前台锁拒绝，steal 才能真的到最前
  mainWindow.setAlwaysOnTop(true)
  app.focus({ steal: true })
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
    icon: windowIconPath() || undefined,
    skipTaskbar: false,
    titleBarStyle: 'hidden',
    ...(process.platform === 'win32'
      ? {
          titleBarOverlay: {
            ...windowColors(nativeTheme.shouldUseDarkColors),
            height: 40
          },
          ...(win11 ? { backgroundMaterial: 'mica' as const } : {})
        }
      : process.platform === 'darwin'
        ? { trafficLightPosition: { x: 14, y: 13 } }
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
      if (tray) mainWindow?.hide()
      else app.quit()
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
    // 桌宠暂停：相关入口已注释，桌面信息统一由「任务岛」承载。
    // schedulePetCreation()
    notifyIsland()
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

function notifyUser(body: string): void {
  try {
    if (Notification.isSupported()) new Notification({ title: '轻单', body }).show()
  } catch {
    /* notifications are best effort */
  }
}

/** Ctrl+Shift+V：把剪贴板文字直接变成一条待办。 */
async function captureClipboard(): Promise<void> {
  const text = (await clipboard.readText()).trim()
  if (!text) {
    notifyUser('剪贴板里没有文字')
    return
  }
  showMain()
  sendToRendererWhenReady('ui:quick-add', text.slice(0, 2000))
}

/** Ctrl+Shift+O（可自定义）：框选屏幕 → OCR → 取带时间的一行填入快速添加。 */
async function captureAndOcr(): Promise<void> {
  try {
    log('CAPTURE_START')
    const png = await captureScreenRegion()
    if (!png) {
      log('CAPTURE_CANCELLED')
      return
    }
    const size = nativeImage.createFromBuffer(png).getSize()
    log(`CAPTURE_OK bytes=${png.length} size=${size.width}x${size.height}`)
    let text = ''
    let lines: string[] = []
    try {
      const result = await ocrImageBuffer(png)
      text = result.text
      lines = result.lines
      log(`OCR_OK lines=${result.lines.length}`)
    } catch (error) {
      // OCR failure should not throw away the screenshot: the user can still
      // type the task by hand in the capture dialog.
      log(`OCR_FAILED ${String((error as Error)?.message ?? error)}`)
    }
    showMain()
    sendToRendererWhenReady('ui:capture-result', {
      image: `data:image/png;base64,${png.toString('base64')}`,
      text,
      lines
    })
  } catch (error) {
    log(`CAPTURE_FAILED ${String((error as Error)?.stack ?? error)}`)
    notifyUser(String((error as Error)?.message ?? error))
  }
}

const SHORTCUT_DEFAULTS: Record<ShortcutKind, string> = {
  quickAdd: 'CommandOrControl+Alt+Space',
  clipboard: 'CommandOrControl+Alt+C',
  ocr: 'CommandOrControl+Alt+Shift+O'
}
const SHORTCUT_SETTINGS: Record<ShortcutKind, string> = {
  quickAdd: 'shortcut_quick_add',
  clipboard: 'shortcut_clipboard',
  ocr: 'ocr_shortcut'
}
const SHORTCUT_LABELS: Record<ShortcutKind, string> = {
  quickAdd: '全局快速添加',
  clipboard: '剪贴板捕获',
  ocr: '截图识别'
}
const SHORTCUT_HINTS: Record<ShortcutKind, string> = {
  quickAdd: '任意界面唤起快速添加',
  clipboard: '把剪贴板文字直接变成任务',
  ocr: '框选屏幕 → OCR → 截图任务卡'
}
const activeShortcuts: Partial<Record<ShortcutKind, string>> = {}

function shortcutRunner(kind: ShortcutKind): () => void {
  if (kind === 'quickAdd') return () => quickAdd()
  if (kind === 'clipboard') return () => void captureClipboard()
  return () => void captureAndOcr()
}

/** Register (or replace) one global shortcut. Returns false when occupied. */
function registerShortcut(kind: ShortcutKind, accelerator: string): boolean {
  const previous = activeShortcuts[kind]
  if (previous) {
    globalShortcut.unregister(previous)
    delete activeShortcuts[kind]
  }
  if (!accelerator) return true
  try {
    const ok = globalShortcut.register(accelerator, shortcutRunner(kind))
    if (ok) activeShortcuts[kind] = accelerator
    return ok
  } catch {
    return false
  }
}

function shortcutInfo(): ShortcutInfo[] {
  return (Object.keys(SHORTCUT_DEFAULTS) as ShortcutKind[]).map((kind) => ({
    kind,
    label: SHORTCUT_LABELS[kind],
    accelerator: activeShortcuts[kind] ?? getSetting(SHORTCUT_SETTINGS[kind]) ?? SHORTCUT_DEFAULTS[kind],
    defaultAccelerator: SHORTCUT_DEFAULTS[kind],
    registered: !!activeShortcuts[kind],
    hint: SHORTCUT_HINTS[kind]
  }))
}

function registerAllShortcuts(): void {
  for (const kind of Object.keys(SHORTCUT_DEFAULTS) as ShortcutKind[]) {
    const preferred = getSetting(SHORTCUT_SETTINGS[kind]) ?? SHORTCUT_DEFAULTS[kind]
    if (registerShortcut(kind, preferred)) continue
    log(`SHORTCUT_FAILED ${kind} ${preferred}`)
    if (kind !== 'ocr') continue
    // OCR 默认键被占用时退到更少冲突的组合，并把实际生效值写回设置。
    for (const fallback of [
      'CommandOrControl+Alt+Shift+O',
      'CommandOrControl+Shift+Alt+S',
      'CommandOrControl+Alt+P'
    ]) {
      if (registerShortcut('ocr', fallback)) {
        setSetting(SHORTCUT_SETTINGS.ocr, fallback)
        break
      }
    }
  }
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
  const p = trayIconPath()
  if (!p) {
    console.warn('TRAY_ICON_MISSING')
    return
  }
  // macOS 菜单栏用单色 template 图标，避免彩色圆角方块在菜单栏里显得突兀。
  const templatePath = process.platform === 'darwin'
    ? [join(process.resourcesPath, 'trayTemplate.png'), join(app.getAppPath(), 'build', 'trayTemplate.png')].find(existsSync)
    : null
  const image = templatePath
    ? (() => {
        const img = nativeImage.createFromPath(templatePath).resize({ width: 18, height: 18 })
        img.setTemplateImage(true)
        return img
      })()
    : nativeImage.createFromPath(p).resize({ width: 16, height: 16 })
  tray = new Tray(image)
  tray.setToolTip('轻单 LightTodo')
  const menu = Menu.buildFromTemplate([
    { label: '打开轻单', click: showMain },
    { label: '新建任务', click: quickAdd },
    {
      label: '收工 / 今日收尾',
      click: () => {
        showMain()
        sendToRendererWhenReady('ui:shutdown')
      }
    },
    { label: '显示 / 隐藏任务岛', click: toggleIsland },
    // 桌宠暂停：{ label: '显示 / 隐藏桌面伙伴', click: togglePet },
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
  // Windows 11 默认把新托盘图标放进「^」溢出区；第一次启动给个气泡提示。
  if (process.platform === 'win32' && getSetting('tray_hint_shown') !== '1') {
    setTimeout(() => {
      try {
        tray?.displayBalloon({
          title: '轻单还在运行',
          content: '窗口关闭后会驻留在右下角托盘；找不到时点任务栏的「^」。'
        })
        setSetting('tray_hint_shown', '1')
      } catch {
        /* best effort */
      }
    }, 2500)
  }
  // macOS 单击菜单栏图标应展开菜单，不再额外抢焦点打开主窗口。
  if (process.platform !== 'darwin') tray.on('click', showMain)
}

/** macOS 需要标准应用菜单，否则 Cmd+C/V/Q 等系统快捷键会缺失。 */
function installApplicationMenu(): void {
  if (process.platform !== 'darwin') return
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' }
  ]))
}

const REMINDER_MISSED_AFTER_MS = 10 * 60 * 1000
const REMINDER_MAX_TASKS_PER_TICK = 3

function markRemindersSent(tasks: Task[]): void {
  for (const task of tasks) {
    try {
      markReminderSent(task.id)
    } catch (error) {
      console.warn('REMINDER_MARK_FAILED', task.id, error)
    }
  }
}

function showReminderSummary(body: string): void {
  try {
    const n = new Notification({ title: '轻单', body })
    n.on('click', () => showMain())
    n.show()
  } catch (error) {
    console.warn('REMINDER_SUMMARY_FAILED', error)
  }
}

function showReminderNotification(task: Task): void {
  const handleAction = (index: number): void => {
    try {
      if (index === 0) setTaskStatus(task.id, true)
      else if (index === 1) snoozeReminder(task.id, 10)
      else return
      notifyTaskWindows()
    } catch (error) {
      console.warn('REMINDER_ACTION_FAILED', task.id, error)
    }
  }

  // Windows: toast XML carries protocol buttons, so they work even when the
  // toast activates a fresh instance instead of the running renderer.
  if (process.platform === 'win32') {
    try {
      const toast = new Notification({ toastXml: buildTaskToastXml(task) })
      toast.on('click', () => {
        showMain()
        sendToRendererWhenReady('ui:open-task', task.id)
      })
      toast.show()
      if (task.urgent) mainWindow?.flashFrame(true)
      return
    } catch (error) {
      console.warn('TOAST_XML_FAILED', task.id, error)
    }
  }

  // macOS / non-Windows / toast fallback: native buttons handled in-process.
  try {
    const n = new Notification({
      title: task.urgent ? '轻单 · 紧急提醒' : '轻单 · 提醒',
      body: task.title,
      silent: !task.urgent,
      ...(task.urgent ? { timeoutType: 'never' as const } : {}),
      actions: [
        { type: 'button', text: '完成' },
        { type: 'button', text: '稍后 10 分钟' }
      ]
    })
    n.on('show', () => {
      if (task.urgent) mainWindow?.flashFrame(true)
    })
    n.on('click', () => {
      showMain()
      sendToRendererWhenReady('ui:open-task', task.id)
    })
    n.on('action', (_event, index) => handleAction(index))
    n.show()
  } catch (error) {
    console.warn('REMINDER_NOTIFICATION_FAILED', task.id, error)
  }
}

function startReminderLoop(): void {
  const tick = (): void => {
    try {
      if (getSetting('reminders_enabled') === '0') return
    } catch {
      /* ignore */
    }
    const now = Date.now()
    let due: ReturnType<typeof getDueReminders>
    try {
      due = getDueReminders(new Date(now).toISOString())
    } catch (e) {
      console.error('reminder query failed', e)
      return
    }
    if (!due.length) return

    const cutoff = now - REMINDER_MISSED_AFTER_MS
    const missed: Task[] = []
    const fresh: Task[] = []
    for (const task of due) {
      const at = task.reminderAt ? Date.parse(task.reminderAt) : Number.NaN
      // An unparsable reminder timestamp is treated as fresh rather than lost.
      if (Number.isFinite(at) && at < cutoff) missed.push(task)
      else fresh.push(task)
    }

    const supported = Notification.isSupported()

    // One digest for everything that missed its 10-minute window; revealing
    // each stale reminder would flood the action center after sleep/resume.
    if (missed.length) {
      if (supported) showReminderSummary(`有 ${missed.length} 条提醒已错过，打开今天查看`)
      markRemindersSent(missed)
    }

    if (fresh.length) {
      const shown = fresh.slice(0, REMINDER_MAX_TASKS_PER_TICK)
      if (supported) {
        for (const task of shown) showReminderNotification(task)
        if (fresh.length > shown.length) {
          showReminderSummary(`还有 ${fresh.length - shown.length} 条提醒`)
        }
      }
      // Even when native notifications are unsupported, consume the reminders
      // so the loop does not spin on the same rows forever.
      markRemindersSent(fresh)
    }
  }
  setTimeout(tick, 3000)
  setInterval(tick, 30000)
}

function handleProtocolUrl(url: string): void {
  console.log('PROTOCOL_URL', url)

  // Reminder actions never hijack focus: complete/snooze only mutate data and
  // refresh windows. open is the one action the user expects to bring app up.
  const reminder = parseReminderProtocol(url)
  if (reminder) {
    try {
      if (reminder.action === 'complete') {
        setTaskStatus(reminder.id, true)
        notifyTaskWindows()
        updateTaskbarBadge()
      } else if (reminder.action === 'snooze') {
        snoozeReminder(reminder.id, reminder.minutes ?? 10)
        notifyTaskWindows()
        updateTaskbarBadge()
      } else {
        showMain()
        sendToRendererWhenReady('ui:open-task', reminder.id)
      }
    } catch (e) {
      console.warn('REMINDER_PROTOCOL_FAILED', url, e)
    }
    return
  }

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

  if (app.isPackaged && process.platform === 'win32') {
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
  const dataDir = resolveDataDir()
  const migration =
    app.isPackaged && process.env.PORTABLE_EXECUTABLE_DIR
      ? migrateLegacyDatabase({
          currentDir: dataDir,
          appDataDir: app.getPath('appData'),
          executableDir: process.env.PORTABLE_EXECUTABLE_DIR
        })
      : { migrated: false }
  if (migration.migrated) {
    log(`DATA_MIGRATED from=${migration.from} tasks=${migration.tasks}`)
  }
  initDb(dataDir)
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
  ipcMain.handle('shortcuts:list', () => shortcutInfo())
  ipcMain.handle('shortcuts:set', (_event, kind: ShortcutKind, accelerator: string) => {
    if (!(kind in SHORTCUT_DEFAULTS)) throw new Error('未知快捷键')
    if (typeof accelerator !== 'string' || !accelerator.trim()) throw new Error('快捷键不能为空')
    const clean = accelerator.trim()
    if (!/^[A-Za-z0-9+_-]{3,64}$/.test(clean)) throw new Error('快捷键格式无效')
    const previous = activeShortcuts[kind]
    if (!registerShortcut(kind, clean)) {
      if (previous) registerShortcut(kind, previous)
      throw new Error('这个快捷键已被系统或其他程序占用，请换一个')
    }
    setSetting(SHORTCUT_SETTINGS[kind], clean)
    return shortcutInfo()
  })
  ipcMain.handle('shortcuts:reset', (_event, kind: ShortcutKind) => {
    if (!(kind in SHORTCUT_DEFAULTS)) throw new Error('未知快捷键')
    if (!registerShortcut(kind, SHORTCUT_DEFAULTS[kind])) {
      throw new Error('默认快捷键被占用，请手动设置一个')
    }
    setSetting(SHORTCUT_SETTINGS[kind], SHORTCUT_DEFAULTS[kind])
    return shortcutInfo()
  })
  ipcMain.handle('capture:copyImage', async (_event, dataUrl: string) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
      throw new Error('图片数据无效')
    }
    const image = nativeImage.createFromDataURL(dataUrl)
    if (image.isEmpty()) throw new Error('图片数据无效')
    const blob = new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' })
    await clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  })
  ipcMain.handle('capture:copyText', async (_event, text: string) => {
    if (typeof text !== 'string') throw new Error('文字内容无效')
    await clipboard.writeText(text)
    return true
  })
  installApplicationMenu()
  if (process.platform === 'darwin') {
    const dockIcon = iconPath()
    if (dockIcon) app.dock?.setIcon(dockIcon)
  }
  registerIpc()
  registerDataIpc()
  createWindow()
  // 桌宠暂停（代码保留，后续如需恢复把下面几行取消注释即可）
  // registerPet((id, settings) => {
  //   showMain()
  //   if (id) sendToRendererWhenReady('ui:open-task', id)
  //   if (settings) sendToRendererWhenReady('ui:settings')
  // }, T0)
  registerIsland((id, settings) => {
    showMain()
    if (id) sendToRendererWhenReady('ui:open-task', id)
    if (settings) sendToRendererWhenReady('ui:settings')
  }, () => { notifyTaskWindows(); updateTaskbarBadge() })
  createTray()
  setTimeout(updateTaskbarBadge, 1200)
  if (migration.migrated) {
    setTimeout(
      () => sendToRendererWhenReady('ui:data-migrated', { from: migration.from, tasks: migration.tasks }),
      2500
    )
  }
  registerAllShortcuts()
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
  // 桌宠暂停：stopPet()
  stopIsland()
  globalShortcut.unregisterAll()
  void closeOcrEngine()
  backupNow('exit')
  closeDb()
})
