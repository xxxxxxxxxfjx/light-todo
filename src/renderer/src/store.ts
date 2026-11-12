import { create } from 'zustand'
import { resolveQuickAddDate } from './lib/quick-add-date'
import type { CaptureResult, CreateTaskInput, ListSection, SavedFilter, SidebarData, Task, UpdateTaskInput, ViewKey } from '@shared/types'
import { matchFilter, type TaskFilter } from './lib/task-filter'
export type { TaskFilter } from './lib/task-filter'

export interface ViewState {
  type: ViewKey
  listId?: string
  tagId?: string
  filterId?: string
  title: string
}


const EMPTY_SIDEBAR: SidebarData = { folders: [], lists: [], tags: [], counts: {} }

// Keep the first paint small: a local SQLite query is cheap, but shipping
// thousands of task objects through IPC and holding them in React state is not.
// Virtual scrolling makes large lists usable; these limits keep the common
// views light while "加载更多" still exposes the full history.
const INITIAL_LIMITS: Record<ViewKey, number> = {
  inbox: 500,
  today: 500,
  upcoming: 500,
  all: 500,
  someday: 300,
  completed: 200,
  trash: 200,
  calendar: -1,
  review: 0,
  list: 500,
  tag: 500,
  filter: 500
}
const PAGE_SIZE = 500

interface AppStore {
  view: ViewState
  tasks: Task[]
  selected: Task | null
  sidebar: SidebarData
  sidebarOpen: boolean
  toggleSidebar: () => void
  closeSidebar: () => void
  loading: boolean
  error: string
  hasMore: boolean
  calendarRange: { from: string; to: string } | null
  /** 日历当前选中的那一天；在日历里新建任务默认落到这天。 */
  calendarDate: string | null
  /** 从热力图等入口跳转到日历时，指定要打开的那一天。 */
  calendarJumpDate: string | null
  setCalendarRange: (from: string, to: string) => Promise<void>
  setCalendarDate: (date: string | null) => void
  setCalendarJumpDate: (date: string | null) => void
  loadMore: () => Promise<void>
  filter: TaskFilter
  quickAddOpen: boolean
  quickAddInitial: string
  quickAddDate: string | null
  /** 全局捕获（托盘 / 全局快捷键 / lighttodo://add）标记：默认进收件箱。 */
  quickAddInbox: boolean
  selectMode: boolean
  selectedIds: string[]
  batchBusy: boolean
  searchOpen: boolean
  settingsOpen: boolean
  filterEditorOpen: boolean
  editingFilter: SavedFilter | null
  replanOpen: boolean
  shutdownOpen: boolean
  capture: CaptureResult | null
  setCapture: (result: CaptureResult) => void
  closeCapture: () => void
  filters: SavedFilter[]
  sections: ListSection[]
  timer: { taskId: string; startedAt: string } | null
  openFilterEditor: (filter?: SavedFilter | null) => void
  closeFilterEditor: () => void
  loadFilters: () => Promise<void>
  loadSections: (listId: string) => Promise<void>
  openReplan: () => void
  closeReplan: () => void
  openShutdown: () => void
  closeShutdown: () => void
  startTimer: (taskId: string) => void
  stopTimer: () => Promise<void>
  toast: string
  /** 最近一次可撤销操作的说明；空字符串表示没有可撤销操作。 */
  undoLabel: string
  undo: () => Promise<void>
  moveTask: (id: string, targetId: string, place?: 'before' | 'after') => Promise<void>
  setFilter: (f: TaskFilter) => void
  setView: (type: ViewKey, opts?: { listId?: string; tagId?: string; filterId?: string; title?: string }) => Promise<void>
  refresh: () => Promise<void>
  refreshSidebar: () => Promise<void>
  selectTask: (id: string | null) => Promise<void>
  selectTaskById: (id: string) => Promise<void>
  toggleTask: (id: string) => Promise<void>
  createTask: (input: CreateTaskInput) => Promise<Task>
  updateTask: (id: string, patch: UpdateTaskInput) => Promise<Task | null>
  deleteTask: (id: string) => Promise<void>
  restoreTask: (id: string) => Promise<void>
  purgeTask: (id: string) => Promise<void>
  toggleSelectMode: () => void
  toggleSelectId: (id: string) => void
  selectAll: () => void
  clearSelection: () => void
  batchComplete: () => Promise<void>
  batchDelete: () => Promise<void>
  batchRestore: () => Promise<void>
  batchPurge: () => Promise<void>
  openQuickAdd: (text?: string, date?: string, inbox?: boolean) => void
  closeQuickAdd: () => void
  openSearch: () => void
  closeSearch: () => void
  openSettings: () => void
  closeSettings: () => void
  showToast: (msg: string) => void
}

let toastTimer: ReturnType<typeof setTimeout> | null = null
let refreshId = 0
let selectionId = 0
// Highest row count this view has attempted to load. refresh() must not shrink
// back to the initial page while a loadMore request is still in flight.
let requestedLimit = 0

interface UndoAction {
  label: string
  run: () => Promise<void>
}

const undoStack: UndoAction[] = []
const UNDO_LIMIT = 30

function pushUndo(label: string, run: () => Promise<void>): void {
  undoStack.push({ label, run })
  if (undoStack.length > UNDO_LIMIT) undoStack.shift()
  useStore.setState({ undoLabel: label })
}

/** Midpoint between two sort_order values, leaving room for later inserts. */
function sortOrderBetween(prev: number | undefined, next: number | undefined): number {
  if (prev === undefined && next === undefined) return Date.now()
  if (prev === undefined) return next! - 1024
  if (next === undefined) return prev + 1024
  return (prev + next) / 2
}

export const useStore = create<AppStore>((set, get) => ({
  view: { type: 'today', title: '今天' },
  tasks: [],
  selected: null,
  sidebar: EMPTY_SIDEBAR,
  sidebarOpen: false,
  toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),
  closeSidebar: () => set({ sidebarOpen: false }),
  loading: false,
  error: '',
  hasMore: false,
  calendarRange: null,
  calendarDate: null,
  calendarJumpDate: null,
  setCalendarDate: (date) => set({ calendarDate: date }),
  setCalendarJumpDate: (date) => set({ calendarJumpDate: date }),
  setCalendarRange: async (from, to) => {
    const previous = get().calendarRange
    if (previous?.from === from && previous.to === to) return
    set({ calendarRange: { from, to } })
    if (get().view.type === 'calendar') await get().refresh()
  },
  filter: 'all',
  quickAddOpen: false,
  quickAddInitial: '',
  quickAddDate: null,
  quickAddInbox: false,
  selectMode: false,
  selectedIds: [],
  batchBusy: false,
  searchOpen: false,
  settingsOpen: false,
  filterEditorOpen: false,
  editingFilter: null,
  replanOpen: false,
  shutdownOpen: false,
  capture: null,
  filters: [],
  sections: [],
  timer: null,
  toast: '',
  undoLabel: '',

  setFilter: (filter) => set({ filter, selectedIds: [] }),

  setView: async (type, opts) => {
    if (type === 'calendar' && get().view.type === 'calendar') return
    const title =
      opts?.title ??
      ({
        inbox: '收件箱',
        today: '今天',
        upcoming: '最近 7 天',
        all: '全部',
        someday: '也许',
        completed: '已完成',
        trash: '回收站',
        calendar: '日历',
        review: '周复盘',
        list: '清单',
        tag: '标签',
        filter: '过滤器'
      } as Record<ViewKey, string>)[type]
    selectionId++
    requestedLimit = 0
    if (type === 'review') {
      // 周复盘自己通过 review:get 取数，不能把 review 当成任务视图去查列表。
      refreshId++
      set({
        view: { type, ...opts, title },
        tasks: [],
        selected: null,
        filter: 'all',
        selectedIds: [],
        selectMode: false,
        batchBusy: false,
        sidebarOpen: false,
        loading: false,
        error: ''
      })
      return
    }
    set({ view: { type, ...opts, title }, tasks: [], selected: null, filter: 'all', selectedIds: [], selectMode: false, batchBusy: false, sidebarOpen: false })
    await get().refresh()
  },

  refresh: async () => {
    const { view, calendarRange } = get()
    if (view.type === 'review') {
      set({ loading: false, error: '' })
      return
    }
    const request = ++refreshId
    // The mounted calendar supplies its visible range. Never load the entire
    // historical database while waiting for that first range.
    if (view.type === 'calendar' && !calendarRange) {
      set({ loading: true, error: '' })
      return
    }
    const limit =
      view.type === 'calendar'
        ? -1
        : Math.max(get().tasks.length, INITIAL_LIMITS[view.type] ?? 500, requestedLimit)
    set({ loading: true, error: '' })
    try {
      const tasks = await window.api.tasks.list({
        view: view.type,
        listId: view.listId,
        tagId: view.tagId,
        filterId: view.filterId,
        limit,
        ...(view.type === 'calendar' && calendarRange ? { dateFrom: calendarRange.from, dateTo: calendarRange.to } : {})
      })
      if (request === refreshId) set({ tasks, loading: false, hasMore: limit > 0 && tasks.length === limit })
    } catch (e) {
      console.error(e)
      if (request === refreshId) set({ loading: false, error: '任务加载失败，请重试' })
    }
  },

  loadMore: async () => {
    if (get().loading) return
    const { view, tasks } = get()
    if (view.type === 'review') return
    const request = ++refreshId
    // Reserve the page before awaiting so a concurrent refresh cannot shrink
    // the list back to the initial limit and discard this page.
    requestedLimit = Math.max(requestedLimit, tasks.length + PAGE_SIZE)
    set({ loading: true, error: '' })
    try {
      const more = await window.api.tasks.list({ view: view.type, listId: view.listId, tagId: view.tagId, filterId: view.filterId, limit: PAGE_SIZE, offset: tasks.length })
      if (request === refreshId) {
        requestedLimit = Math.max(requestedLimit, tasks.length + more.length)
        set({ tasks: [...tasks, ...more], loading: false, hasMore: more.length === PAGE_SIZE })
      }
    } catch {
      if (request === refreshId) set({ loading: false, error: '更多任务加载失败，请重试' })
    }
  },

  refreshSidebar: async () => {
    try {
      const sidebar = await window.api.sidebar.get()
      set({ sidebar })
    } catch (e) {
      console.error(e)
    }
  },

  loadFilters: async () => {
    try {
      set({ filters: await window.api.filters.list() })
    } catch (e) {
      console.error(e)
    }
  },

  loadSections: async (listId) => {
    try {
      set({ sections: await window.api.sections.list(listId) })
    } catch (e) {
      console.error(e)
      set({ sections: [] })
    }
  },

  openFilterEditor: (filter = null) => set({ filterEditorOpen: true, editingFilter: filter }),
  closeFilterEditor: () => set({ filterEditorOpen: false, editingFilter: null }),
  openReplan: () => set({ replanOpen: true }),  closeReplan: () => {
    try {
      void window.api.settings.set('replan_last_shown', new Date().toLocaleDateString('sv-SE'))
    } catch {
      /* best effort */
    }
    set({ replanOpen: false })
  },
  openShutdown: () => set({ shutdownOpen: true }),
  closeShutdown: () => set({ shutdownOpen: false }),
  setCapture: (result) => set({ capture: result }),
  closeCapture: () => set({ capture: null }),

  startTimer: (taskId) => {
    if (get().timer?.taskId === taskId) return
    set({ timer: { taskId, startedAt: new Date().toISOString() } })
    get().showToast('开始计时')
  },

  stopTimer: async () => {
    const active = get().timer
    if (!active) return
    set({ timer: null })
    try {
      const task = await window.api.tasks.addTime(active.taskId, active.startedAt, new Date().toISOString())
      const { selected } = get()
      if (selected?.id === active.taskId) set({ selected: task })
      await Promise.all([get().refresh(), get().refreshSidebar()])
      get().showToast('已记录本次用时')
    } catch (error) {
      get().showToast(`记录用时失败：${String(error)}`)
    }
  },

  selectTask: async (id) => {
    const request = ++selectionId
    if (!id) {
      set({ selected: null })
      return
    }
    const cached = get().tasks.find(task => task.id === id)
    if (cached) set({ selected: cached })
    const task = await window.api.tasks.get(id)
    if (request === selectionId) set({ selected: task })
  },

  selectTaskById: async (id) => {
    const request = ++selectionId
    const task = await window.api.tasks.get(id)
    if (request === selectionId) set({ selected: task, searchOpen: false })
  },

  toggleTask: async (id) => {
    const task = get().tasks.find((t) => t.id === id) ?? get().selected
    if (!task) return
    const wasDone = task.status === 1
    await window.api.tasks.setStatus(id, !wasDone)
    const { selected } = get()
    if (selected?.id === id) {
      set({ selected: await window.api.tasks.get(id) })
    }
    await Promise.all([get().refresh(), get().refreshSidebar()])
    pushUndo(wasDone ? `恢复「${task.title}」` : `完成「${task.title}」`, async () => {
      await window.api.tasks.setStatus(id, wasDone)
      await Promise.all([get().refresh(), get().refreshSidebar()])
    })
  },

  createTask: async (input) => {
    const task = await window.api.tasks.create(input)
    await Promise.all([get().refresh(), get().refreshSidebar()])
    return task
  },

  updateTask: async (id, patch) => {
    const beforeTask = get().tasks.find((t) => t.id === id) ?? get().selected
    const task = await window.api.tasks.update(id, patch)
    const { selected } = get()
    if (selected?.id === id) set({ selected: task })
    await Promise.all([get().refresh(), get().refreshSidebar()])

    // Undo only covers moves (date/someday/list). Typing title/notes should
    // never create an undo entry that surprises the user with Ctrl+Z.
    if (beforeTask) {
      const before: UpdateTaskInput = {}
      const moveKeys: (keyof UpdateTaskInput)[] = ['scheduledDate', 'dueAt', 'someday', 'listId']
      let changed = false
      for (const key of moveKeys) {
        if (!Object.prototype.hasOwnProperty.call(patch, key)) continue
        const oldValue = beforeTask[key as keyof typeof beforeTask]
        if (oldValue !== patch[key]) {
          ;(before as Record<string, unknown>)[key] = oldValue
          changed = true
        }
      }
      if (changed) {
        const label = patch.someday === true ? '移到也许' : patch.scheduledDate !== undefined ? '调整日期' : '移动任务'
        pushUndo(label, async () => {
          await window.api.tasks.update(id, before)
          await Promise.all([get().refresh(), get().refreshSidebar()])
        })
      }
    }
    return task
  },

  deleteTask: async (id) => {
    const task = get().tasks.find((t) => t.id === id) ?? get().selected
    await window.api.tasks.remove(id)
    if (get().selected?.id === id) set({ selected: null })
    await Promise.all([get().refresh(), get().refreshSidebar()])
    get().showToast('已移到回收站')
    if (task) {
      pushUndo(`删除「${task.title}」`, async () => {
        await window.api.tasks.restore(id)
        await Promise.all([get().refresh(), get().refreshSidebar()])
      })
    }
  },

  undo: async () => {
    const action = undoStack.pop()
    if (!action) return
    try {
      await action.run()
      set({ undoLabel: undoStack.length ? undoStack[undoStack.length - 1].label : '' })
      get().showToast(`已撤销：${action.label}`)
    } catch (error) {
      undoStack.push(action)
      get().showToast('撤销失败，请重试')
      throw error
    }
  },

  moveTask: async (id, targetId, place = 'before') => {
    const tasks = get().tasks
    const dragged = tasks.find((t) => t.id === id)
    if (!dragged || id === targetId) return
    const rest = tasks.filter((t) => t.id !== id)
    const targetIndex = rest.findIndex((t) => t.id === targetId)
    if (targetIndex < 0) return
    const insertAt = place === 'before' ? targetIndex : targetIndex + 1
    const sortOrder = sortOrderBetween(rest[insertAt - 1]?.sortOrder, rest[insertAt]?.sortOrder)
    await window.api.tasks.reorder([{ id, sortOrder }])
    await Promise.all([get().refresh(), get().refreshSidebar()])
    pushUndo('拖动排序', async () => {
      await window.api.tasks.reorder([{ id, sortOrder: dragged.sortOrder }])
      await Promise.all([get().refresh(), get().refreshSidebar()])
    })
  },

  restoreTask: async (id) => {
    await window.api.tasks.restore(id)
    await Promise.all([get().refresh(), get().refreshSidebar()])
    get().showToast('已恢复')
  },

  purgeTask: async (id) => {
    await window.api.tasks.purge(id)
    await Promise.all([get().refresh(), get().refreshSidebar()])
    get().showToast('已彻底删除')
  },

  toggleSelectMode: () => set({ selectMode: !get().selectMode, selectedIds: [] }),
  toggleSelectId: (id) => {
    const ids = get().selectedIds
    set({ selectedIds: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] })
  },
  selectAll: () => set({ selectedIds: get().tasks.filter(t => matchFilter(t, get().filter)).map((t) => t.id) }),
  clearSelection: () => set({ selectedIds: [], selectMode: false }),

  batchComplete: async () => {
    if (get().batchBusy) return
    const ids = get().selectedIds.filter(id => get().tasks.some(t => t.id === id && matchFilter(t, get().filter)))
    if (!ids.length) return
    set({ batchBusy: true })
    try {
      await Promise.all(ids.map((id) => window.api.tasks.setStatus(id, true)))
      set({ selectedIds: [], selectMode: false })
      await Promise.all([get().refresh(), get().refreshSidebar()])
      get().showToast(`已完成 ${ids.length} 项`)
    } finally {
      set({ batchBusy: false })
    }
  },

  batchDelete: async () => {
    if (get().batchBusy) return
    const ids = get().selectedIds.filter(id => get().tasks.some(t => t.id === id && matchFilter(t, get().filter)))
    if (!ids.length) return
    set({ batchBusy: true })
    try {
      await Promise.all(ids.map((id) => window.api.tasks.remove(id)))
      if (get().selected && ids.includes(get().selected!.id)) set({ selected: null })
      set({ selectedIds: [], selectMode: false })
      await Promise.all([get().refresh(), get().refreshSidebar()])
      get().showToast(`已移到回收站 ${ids.length} 项`)
    } finally {
      set({ batchBusy: false })
    }
  },

  batchRestore: async () => {
    if (get().batchBusy) return
    const ids = get().selectedIds.filter(id => get().tasks.some(t => t.id === id && matchFilter(t, get().filter)))
    if (!ids.length) return
    set({ batchBusy: true })
    try {
      await Promise.all(ids.map((id) => window.api.tasks.restore(id)))
      set({ selectedIds: [], selectMode: false })
      await Promise.all([get().refresh(), get().refreshSidebar()])
      get().showToast(`已恢复 ${ids.length} 项`)
    } finally {
      set({ batchBusy: false })
    }
  },

  batchPurge: async () => {
    if (get().batchBusy) return
    const ids = get().selectedIds.filter(id => get().tasks.some(t => t.id === id && matchFilter(t, get().filter)))
    if (!ids.length) return
    set({ batchBusy: true })
    try {
      await Promise.all(ids.map((id) => window.api.tasks.purge(id)))
      if (get().selected && ids.includes(get().selected!.id)) set({ selected: null })
      set({ selectedIds: [], selectMode: false })
      await Promise.all([get().refresh(), get().refreshSidebar()])
      get().showToast(`已彻底删除 ${ids.length} 项`)
    } finally {
      set({ batchBusy: false })
    }
  },

  openQuickAdd: (text = '', date, inbox = false) => {
    // 日历里点选/切换日期后，Ctrl+N、侧栏「新建任务」和命令面板都应落到选中的那天；
    // 全局捕获带 inbox 标记，仍然进入收件箱而不是继承日历日期。
    const calendarDefault = resolveQuickAddDate(date, get().view.type, get().calendarDate, inbox)
    set({
      quickAddOpen: true,
      quickAddInitial: text,
      quickAddDate: calendarDefault,
      quickAddInbox: inbox,
      searchOpen: false,
      settingsOpen: false
    })
  },
  closeQuickAdd: () =>
    set({
      quickAddOpen: false,
      quickAddInitial: '',
      quickAddDate: null,
      quickAddInbox: false
    }),
  openSearch: () => set({ searchOpen: true, quickAddOpen: false, settingsOpen: false }),
  closeSearch: () => set({ searchOpen: false }),
  openSettings: () => set({ settingsOpen: true, quickAddOpen: false, searchOpen: false }),
  closeSettings: () => set({ settingsOpen: false }),

  showToast: (msg) => {
    if (toastTimer) clearTimeout(toastTimer)
    set({ toast: msg })
    toastTimer = setTimeout(() => set({ toast: '' }), 2200)
  }
}))
