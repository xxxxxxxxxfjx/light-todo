import { app, BrowserWindow, ipcMain, Menu, nativeTheme, screen } from 'electron'
import { join } from 'node:path'
import { createTask, getSetting, setSetting, listTasks, setTaskStatus, getTask, updateTask, deleteTask } from './db'
import { parseQuickAdd } from '../shared/nlp'
import {
  DEFAULT_ISLAND_SETTINGS,
  ISLAND_ACCENTS,
  ISLAND_CAPSULE,
  ISLAND_STAGE,
  type IslandAccent,
  type IslandNext,
  type IslandSettings,
  type IslandState
} from '../shared/island'
import type { Task } from '../shared/types'

const REFRESH_MS = 30_000
const HOVER_OPEN_MS = 180
const HOVER_CLOSE_MS = 320

type IslandPhase = 'rest' | 'peek' | 'panel'

let island: BrowserWindow | null = null
let stopping = false
let refreshTimer: ReturnType<typeof setInterval> | undefined
let hitTimer: ReturnType<typeof setInterval> | undefined
let phase: IslandPhase = 'rest'
let interactive = false
let hoverTimer: ReturnType<typeof setTimeout> | undefined
let leaveTimer: ReturnType<typeof setTimeout> | undefined
let drag: { startX: number; winX: number } | null = null
let editing = false
let transitionUntil = 0
let openMain: (id?: string, settings?: boolean) => void = () => {}
let onTasksChanged: () => void = () => {}

export function getIslandSettings(): IslandSettings {
  try {
    const parsed = JSON.parse(getSetting('island_settings') ?? '{}') as Partial<IslandSettings>
    const accent = parsed.accent && parsed.accent in ISLAND_ACCENTS ? parsed.accent as IslandAccent : DEFAULT_ISLAND_SETTINGS.accent
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_ISLAND_SETTINGS.enabled,
      accent
    }
  } catch {
    return { ...DEFAULT_ISLAND_SETTINGS }
  }
}

function todayStr(): string {
  return new Date().toLocaleDateString('sv-SE')
}

function isOverdue(task: Task): boolean {
  const today = todayStr()
  if (task.scheduledDate && task.scheduledDate < today) return true
  if (task.dueAt && new Date(task.dueAt).getTime() < Date.now()) return true
  return false
}

function minutesLeft(task: Task): number | null {
  if (!task.dueAt) return null
  return Math.round((new Date(task.dueAt).getTime() - Date.now()) / 60_000)
}

function nextOf(tasks: Task[]): IslandNext | null {
  const active = tasks.filter(t => t.status !== 1)
  if (active.length === 0) return null
  const score = (t: Task): number => {
    if (t.dueAt) return new Date(t.dueAt).getTime()
    if (t.scheduledDate) return new Date(`${t.scheduledDate}T23:59:00`).getTime()
    return Number.MAX_SAFE_INTEGER
  }
  const task = [...active].sort((a, b) => score(a) - score(b))[0]
  const at = task.dueAt
    ? new Date(task.dueAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : null
  return { id: task.id, title: task.title, at, minutesLeft: minutesLeft(task) }
}

export function islandState(): IslandState {
  const today = todayStr()
  // today 视图只返回未完成；已完成要从 completed 里按完成日期补回来，
  // 否则「勾掉最后一件」时 total 会瞬间变 0，岛直接消失。
  const tasks: Task[] = []
  for (let offset = 0; ; offset += 500) {
    const page = listTasks({ view: 'today', offset, limit: 500 })
    tasks.push(...page)
    if (page.length < 500) break
  }
  const completedToday: Task[] = []
  for (let offset = 0; ; offset += 500) {
    const page = listTasks({ view: 'completed', offset, limit: 500 })
    completedToday.push(...page.filter(t => t.completedAt && new Date(t.completedAt).toLocaleDateString('sv-SE') === today))
    if (page.length < 500) break
  }
  const done = completedToday.length
  const overdue = tasks.filter(t => isOverdue(t)).length
  const soon = tasks.filter(t => {
    if (isOverdue(t)) return false
    const left = minutesLeft(t)
    return left !== null && left >= 0 && left <= 60
  }).length
  return {
    settings: getIslandSettings(),
    theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
    tasks: [...tasks, ...completedToday],
    stats: { total: tasks.length + done, done, remaining: tasks.length, overdue, soon },
    next: nextOf(tasks)
  }
}

export function notifyIsland(): void {
  if (stopping) return
  if (island && !island.isDestroyed()) island.webContents.send('island:changed', islandState())
}

function broadcastSettings(): void {
  const settings = getIslandSettings()
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('island:settings', settings)
}

/** 胶囊尺寸统一取自 shared，避免主进程与渲染层漂移 */
function capsuleRect(): { x: number; y: number; w: number; h: number } {
  const size = ISLAND_CAPSULE[phase]
  return { x: (ISLAND_STAGE.width - size.w) / 2, y: 0, w: size.w, h: size.h }
}

function applyPhase(next: IslandPhase): void {
  if (phase === next) return
  phase = next
  transitionUntil = Date.now() + 320
  if (island && !island.isDestroyed()) {
    island.webContents.send('island:phase-set', next)
    // 面板打开时允许键盘（Ctrl+N / Esc），收起后立刻还原“不抢焦点”
    if (next === 'panel') { island.setFocusable(true); island.focus() }
    else { island.setFocusable(false); island.blur() }
  }
  syncHit()
}

/**
 * 透明窗口在 Electron 里默认会“透明区域也吃鼠标”，而 setIgnoreMouseEvents(true,{forward}) 只转发
 * 移动事件、常拿不到 pointerenter。所以命中判定放在主进程用系统光标坐标做：
 * 光标落在胶囊矩形内就关掉穿透，离开就恢复穿透，稳且不依赖渲染层事件。
 */
function syncHit(): void {
  if (!island || island.isDestroyed()) return
  if (drag || Date.now() < transitionUntil) return
  const point = screen.getCursorScreenPoint()
  const bounds = island.getBounds()
  const rect = capsuleRect()
  const pad = 2
  const inside =
    point.x >= bounds.x + rect.x - pad &&
    point.x <= bounds.x + rect.x + rect.w + pad &&
    point.y >= bounds.y + rect.y - pad &&
    point.y <= bounds.y + rect.y + rect.h + pad
  if (inside === interactive) return
  interactive = inside
  island.setIgnoreMouseEvents(!inside, { forward: true })
  if (inside) {
    clearTimeout(leaveTimer)
    if (phase === 'rest') {
      clearTimeout(hoverTimer)
      hoverTimer = setTimeout(() => applyPhase('peek'), HOVER_OPEN_MS)
    }
  } else {
    clearTimeout(hoverTimer)
    clearTimeout(leaveTimer)
    // 移开就收起（含 panel）：点别的窗口时岛会自然关闭
    if (!editing) leaveTimer = setTimeout(() => applyPhase('rest'), HOVER_CLOSE_MS)
  }
}

function startHitTracking(): void {
  clearInterval(hitTimer)
  hitTimer = setInterval(syncHit, 50)
}

function place(): void {
  if (!island) return
  const display = screen.getPrimaryDisplay()
  const area = display.workArea
  const saved = Number(getSetting('island_x') ?? 'NaN')
  const centered = area.x + (area.width - ISLAND_STAGE.width) / 2
  const x = Number.isFinite(saved)
    ? Math.max(area.x, Math.min(saved, area.x + area.width - ISLAND_STAGE.width))
    : centered
  island.setBounds({
    x: Math.round(x),
    y: area.y,
    width: ISLAND_STAGE.width,
    height: ISLAND_STAGE.height
  })
}

function applyEnabled(): void {
  if (stopping) return
  if (!getIslandSettings().enabled) {
    island?.destroy()
    island = null
    return
  }
  if (island) {
    place()
    return
  }
  island = new BrowserWindow({
    width: ISLAND_STAGE.width,
    height: ISLAND_STAGE.height,
    title: '轻单 · 任务岛',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    focusable: false,
    thickFrame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/island.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'desktop-island'
    }
  })
  island.setAlwaysOnTop(true, 'screen-saver')
  island.setIgnoreMouseEvents(true, { forward: true })
  interactive = false
  phase = 'rest'
  place()
  startHitTracking()
  const win = island
  win.once('ready-to-show', () => {
    if (!stopping && island === win && !win.isDestroyed()) win.showInactive()
  })
  win.webContents.on('did-finish-load', () => {
    if (!stopping && island === win && !win.isDestroyed()) win.webContents.send('island:phase-set', phase)
  })
  win.on('closed', () => { if (island === win) island = null })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/island.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/island.html'))
  }
}

export function setIslandSettings(patch: Partial<IslandSettings>): IslandSettings {
  const next: IslandSettings = { ...getIslandSettings(), ...patch }
  if (!(next.accent in ISLAND_ACCENTS)) next.accent = DEFAULT_ISLAND_SETTINGS.accent
  setSetting('island_settings', JSON.stringify(next))
  applyEnabled()
  notifyIsland()
  broadcastSettings()
  return next
}

export function toggleIsland(): void {
  setIslandSettings({ enabled: !getIslandSettings().enabled })
}

export function registerIsland(showMain: (id?: string, settings?: boolean) => void, tasksChanged: () => void): void {
  openMain = showMain
  onTasksChanged = tasksChanged
  const assertIsland = (sender: Electron.WebContents): void => {
    if (stopping || sender !== island?.webContents) throw new Error('任务岛窗口已关闭')
  }
  const assertToday = (id: string): Task => {
    const task = islandState().tasks.find(t => t.id === id)
    if (!task || !getTask(id)) throw new Error('任务已不在今天列表中，请刷新后重试')
    return task
  }
  ipcMain.handle('island:state', e => { assertIsland(e.sender); return islandState() })
  ipcMain.handle('island:settings', () => getIslandSettings())
  ipcMain.handle('island:setSettings', (_e, patch: Partial<IslandSettings>) => setIslandSettings(patch))
  ipcMain.handle('island:complete', (e, id: string) => {
    assertIsland(e.sender)
    const task = assertToday(id)
    setTaskStatus(id, task.status !== 1)
    notifyIsland()
    onTasksChanged()
  })
  ipcMain.handle('island:update', (e, id: string, title: string) => {
    assertIsland(e.sender)
    assertToday(id)
    if (typeof title !== 'string' || !title.trim()) throw new Error('标题不能为空')
    updateTask(id, { title: title.trim() })
    notifyIsland()
    onTasksChanged()
  })
  ipcMain.handle('island:delete', (e, id: string) => {
    assertIsland(e.sender)
    assertToday(id)
    deleteTask(id)
    notifyIsland()
    onTasksChanged()
  })
  ipcMain.handle('island:quickAdd', (e, text: string) => {
    assertIsland(e.sender)
    if (typeof text !== 'string' || !text.trim()) return null
    const parsed = parseQuickAdd(text.trim())
    const task = createTask({
      title: parsed.title,
      // 岛只服务“今天”：没写日期就落到今天
      scheduledDate: todayStr(),
      dueAt: parsed.dueAt ? (() => { const date = new Date(parsed.dueAt); const today = new Date(); today.setHours(date.getHours(), date.getMinutes(), 0, 0); return today.toISOString() })() : null,
      dueAllDay: parsed.dueAllDay,
      priority: parsed.priority,
      tagNames: parsed.tagNames,
      listId: null
    })
    notifyIsland()
    onTasksChanged()
    return task.id
  })
  ipcMain.on('island:open', (e, id?: string) => {
    if (stopping || e.sender !== island?.webContents) return
    openMain(id)
  })
  ipcMain.on('island:phase', (e, next: IslandPhase) => {
    if (stopping || e.sender !== island?.webContents) return
    if (!['rest', 'peek', 'panel'].includes(next)) return
    applyPhase(next)
  })
  // 顶部拖动：只允许左右移动，纵向永远贴齐工作区顶部
  ipcMain.on('island:drag', (e, stage: 'start' | 'move' | 'end', screenX: number) => {
    if (stopping || e.sender !== island?.webContents || !island) return
    if (stage === 'start') {
      drag = { startX: screenX, winX: island.getBounds().x }
      return
    }
    if (stage === 'move' && drag) {
      const bounds = island.getBounds()
      const area = screen.getPrimaryDisplay().workArea
      const x = Math.max(area.x, Math.min(drag.winX + screenX - drag.startX, area.x + area.width - bounds.width))
      island.setBounds({ ...bounds, x: Math.round(x) })
      return
    }
    if (stage === 'end') {
      drag = null
      setSetting('island_x', String(island.getBounds().x))
    }
  })
  // 快速添加时要能接收键盘：临时把窗口变成可聚焦，收起后再还原
  ipcMain.on('island:focusable', (e, focusable: boolean) => {
    if (stopping || e.sender !== island?.webContents || !island) return
    editing = focusable
    if (editing) clearTimeout(leaveTimer)
    else { interactive = true; syncHit() }
    island.setFocusable(focusable || phase === 'panel')
    if (focusable) island.focus()
    else if (phase !== 'panel') island.blur()
  })
  ipcMain.on('island:quit', e => {
    if (!stopping && e.sender === island?.webContents) app.quit()
  })
  ipcMain.on('island:menu', e => {
    if (stopping || e.sender !== island?.webContents || !island) return
    Menu.buildFromTemplate([
      { label: '打开轻单', click: () => openMain() },
      { label: '隐藏任务岛', click: toggleIsland },
      { label: '恢复顶部居中', click: () => { setSetting('island_x', 'NaN'); place() } },
      { type: 'separator' },
      { label: '退出轻单', click: () => app.quit() }
    ]).popup({ window: island })
  })
  const reposition = (): void => { if (island) place() }
  screen.on('display-added', reposition)
  screen.on('display-removed', reposition)
  screen.on('display-metrics-changed', reposition)
  refreshTimer = setInterval(notifyIsland, REFRESH_MS)
  applyEnabled()
}

export function stopIsland(): void {
  if (stopping) return
  stopping = true
  clearInterval(refreshTimer)
  clearInterval(hitTimer)
  clearTimeout(hoverTimer)
  clearTimeout(leaveTimer)
  island?.destroy()
  island = null
}
