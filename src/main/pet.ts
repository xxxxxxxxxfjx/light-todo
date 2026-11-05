import { app, BrowserWindow, ipcMain, Menu, screen } from 'electron'
import { join } from 'node:path'
import { getSetting, setSetting, listTasks, getTask, setTaskStatus } from './db'
import { DEFAULT_PET_SETTINGS, PET_SIZE, type PetSettings, type PetState } from '../shared/pet'

let pet: BrowserWindow | null = null
let saveTimer: ReturnType<typeof setTimeout> | undefined
let refreshTimer: ReturnType<typeof setInterval> | undefined
let stopping = false
let appliedScale = 1
let petExpanded = false
let cachedTasks: PetState['tasks'] = []
let openMain: (id?: string, settings?: boolean) => void

export function getPetSettings(): PetSettings {
  let saved: Partial<PetSettings> = {}
  try {
    const parsed = JSON.parse(getSetting('pet_settings') ?? '{}')
    if (parsed && typeof parsed === 'object') saved = parsed
  } catch { /* use defaults */ }
  return normalize(saved)
}

function normalize(value: Partial<PetSettings>): PetSettings {
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_PET_SETTINGS.enabled,
    skin: value.skin === 'bunny' ? 'bunny' : 'cat',
    scale: [0.85, 1, 1.15].includes(value.scale ?? 0) ? value.scale! : 1,
    opacity: typeof value.opacity === 'number' && Number.isFinite(value.opacity) ? Math.max(0.5, Math.min(1, value.opacity)) : 1
  }
}

function state(): PetState {
  if (!petExpanded) return { settings: getPetSettings(), tasks: cachedTasks, displayScale: appliedScale }
  // Fetch every page so a busy day never silently drops tasks.
  const tasks: PetState['tasks'] = []
  for (let offset = 0; petExpanded; offset += 1000) {
    const page = listTasks({ view: 'today', offset, limit: 1000 })
    tasks.push(...page.filter(t => t.scheduledDate !== null || t.dueAt !== null))
    if (page.length < 1000) break
  }
  cachedTasks = tasks
  return { settings: getPetSettings(), tasks, displayScale: appliedScale }
}

export function notifyPet(): void {
  if (stopping) return
  if (pet && !pet.isDestroyed()) pet.webContents.send('pet:changed', state())
}

export function notifyTaskWindows(except?: number): void {
  notifyPet()
  for (const win of BrowserWindow.getAllWindows()) {
    if (win !== pet && win.webContents.id !== except) win.webContents.send('tasks:changed')
  }
}

function place(reset = false): void {
  if (!pet) return
  const settings = getPetSettings()
  let saved: { x: number; y: number; displayId: number; width?: number; height?: number } | null = null
  if (!reset) {
    try { saved = JSON.parse(getSetting('pet_position') ?? 'null') } catch { /* reset */ }
  }
  if (saved && (!Number.isFinite(saved.x) || !Number.isFinite(saved.y))) saved = null
  const display = screen.getAllDisplays().find(d => d.id === saved?.displayId) ?? screen.getPrimaryDisplay()
  const area = display.workArea
  // Keep the entire window inside small work areas, including high DPI screens.
  const zoom = Math.min(settings.scale, area.width / PET_SIZE.width, area.height / PET_SIZE.height)
  const width = Math.round(PET_SIZE.width * zoom)
  const height = Math.round(PET_SIZE.height * zoom)
  // Preserve the bottom-right anchor when migrating from the original large card.
  const savedX = saved ? saved.x + (saved.width ?? Math.round(356 * settings.scale)) - width : undefined
  const savedY = saved ? saved.y + (saved.height ?? Math.round(520 * settings.scale)) - height : undefined
  const x = Math.max(area.x, Math.min(savedX ?? area.x + area.width - width - 16, area.x + area.width - width))
  const y = Math.max(area.y, Math.min(savedY ?? area.y + area.height - height - 16, area.y + area.height - height))
  pet.setBounds({ x: Math.round(x), y: Math.round(y), width, height })
  appliedScale = zoom
  pet.setOpacity(settings.opacity)
}

function savePosition(): void {
  if (!pet || pet.isDestroyed() || stopping) return
  const bounds = pet.getBounds()
  setSetting('pet_position', JSON.stringify({ ...bounds, displayId: screen.getDisplayMatching(bounds).id }))
}

function updateSettings(patch: Partial<PetSettings>): PetSettings {
  if (stopping) throw new Error('应用正在退出')
  const previous = getPetSettings()
  const settings = normalize({ ...getPetSettings(), ...patch })
  setSetting('pet_settings', JSON.stringify(settings))
  if (pet && previous.scale !== settings.scale) {
    savePosition()
    clearTimeout(saveTimer)
    pet.destroy()
    pet = null
  }
  syncPet()
  notifyPet()
  // Update settings when changed from the pet menu or tray as well.
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('pet:settings', settings)
  return settings
}

export function togglePet(): void { updateSettings({ enabled: !getPetSettings().enabled }) }

function syncPet(): void {
  if (stopping) return
  if (!getPetSettings().enabled) {
    clearTimeout(saveTimer)
    pet?.destroy()
    pet = null
    return
  }
  if (pet) { savePosition(); place(); return }
  petExpanded = false
  const area = screen.getPrimaryDisplay().workArea
  const scale = Math.min(getPetSettings().scale, area.width / PET_SIZE.width, area.height / PET_SIZE.height)
  pet = new BrowserWindow({
    width: Math.round(PET_SIZE.width * scale), height: Math.round(PET_SIZE.height * scale), title: '轻单 · 桌面伙伴', frame: false,
    transparent: true, backgroundColor: '#00000000', resizable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false,
    focusable: false, thickFrame: false,
    webPreferences: { preload: join(__dirname, '../preload/pet.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'desktop-pet' }
  })
  // An isolated session keeps the main page's remembered Chromium zoom out of the pet.
  pet.webContents.setZoomFactor(1)
  pet.setAlwaysOnTop(true, 'screen-saver')
  pet.setIgnoreMouseEvents(true, { forward: true })
  place()
  const win = pet
  win.on('moved', () => { clearTimeout(saveTimer); saveTimer = setTimeout(savePosition, 250) })
  win.once('ready-to-show', () => {
    if (!stopping && pet === win && !win.isDestroyed()) win.showInactive()
  })
  win.on('closed', () => { if (pet === win) pet = null })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    pet.loadURL(`${process.env.ELECTRON_RENDERER_URL}/pet.html`)
  } else pet.loadFile(join(__dirname, '../renderer/pet.html'))
}

export function registerPet(showMain: typeof openMain): void {
  openMain = showMain
  const assertPet = (sender: Electron.WebContents): void => {
    if (stopping || sender !== pet?.webContents) throw new Error('桌宠窗口已关闭')
  }
  ipcMain.handle('pet:settings', () => getPetSettings())
  ipcMain.handle('pet:setSettings', (_e, patch: Partial<PetSettings>) => updateSettings(patch))
  ipcMain.handle('pet:reset', () => { if (!pet) updateSettings({ enabled: true }); place(true); savePosition() })
  ipcMain.handle('pet:state', e => { assertPet(e.sender); return state() })
  ipcMain.on('pet:expanded', (e, expanded: boolean) => {
    if (stopping || e.sender !== pet?.webContents) return
    petExpanded = expanded === true
    if (petExpanded) notifyPet()
  })
  ipcMain.handle('pet:complete', (e, id: string) => {
    assertPet(e.sender)
    const task = getTask(id)
    if (!task || task.status === 1) return
    setTaskStatus(id, true)
    notifyTaskWindows()
  })
  let drag: { cursor: Electron.Point; x: number; y: number } | null = null
  ipcMain.on('pet:drag', (e, phase: 'start' | 'move' | 'end', point: Electron.Point) => {
    if (stopping || e.sender !== pet?.webContents) return
    if (!pet) return
    if (phase !== 'end' && (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return
    if (phase === 'start') {
      const bounds = pet.getBounds()
      drag = { cursor: point, x: bounds.x, y: bounds.y }
      pet.setIgnoreMouseEvents(false)
    } else if (phase === 'end') {
      drag = null
      savePosition()
    } else if (phase === 'move' && drag) {
      const cursor = point
      const area = screen.getDisplayNearestPoint(cursor).workArea
      const bounds = pet.getBounds()
      pet.setPosition(
        Math.round(Math.max(area.x, Math.min(drag.x + cursor.x - drag.cursor.x, area.x + area.width - bounds.width))),
        Math.round(Math.max(area.y, Math.min(drag.y + cursor.y - drag.cursor.y, area.y + area.height - bounds.height)))
      )
    }
  })
  ipcMain.on('pet:interactive', (e, interactive: boolean) => {
    if (stopping || e.sender !== pet?.webContents) return
    pet?.setIgnoreMouseEvents(!interactive, { forward: true })
  })
  ipcMain.on('pet:open', (e, id?: string, settings?: boolean) => { if (!stopping && e.sender === pet?.webContents) openMain(id, settings) })
  ipcMain.on('pet:menu', e => {
    if (stopping || e.sender !== pet?.webContents) return
    const s = getPetSettings()
    Menu.buildFromTemplate([
      { label: '打开轻单', click: () => openMain() },
      { label: '桌宠设置', click: () => openMain(undefined, true) },
      { type: 'separator' },
      { label: '奶油猫咪', type: 'radio', checked: s.skin === 'cat', click: () => updateSettings({ skin: 'cat' }) },
      { label: '草莓兔兔', type: 'radio', checked: s.skin === 'bunny', click: () => updateSettings({ skin: 'bunny' }) },
      { label: '回到右下角', click: () => { place(true); savePosition() } },
      { label: '隐藏桌面伙伴', click: () => updateSettings({ enabled: false }) }
    ]).popup({ window: pet! })
  })
  const reposition = (): void => { if (pet) { place(); savePosition() } }
  screen.on('display-removed', reposition)
  screen.on('display-metrics-changed', reposition)
  syncPet()
  refreshTimer = setInterval(notifyPet, 30000) // local midnight, resume, and overdue labels
}

export function stopPet(): void {
  if (stopping) return
  savePosition()
  stopping = true
  clearTimeout(saveTimer)
  clearInterval(refreshTimer)
  petExpanded = false
  cachedTasks = []
  pet?.destroy()
  pet = null
}
