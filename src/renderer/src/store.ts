import { create } from 'zustand'
import type { CreateTaskInput, SidebarData, Task, UpdateTaskInput, ViewKey } from '@shared/types'
import { matchFilter, type TaskFilter } from './lib/task-filter'
export type { TaskFilter } from './lib/task-filter'

export interface ViewState {
  type: ViewKey
  listId?: string
  tagId?: string
  title: string
}


const EMPTY_SIDEBAR: SidebarData = { folders: [], lists: [], tags: [], counts: {} }

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
  setCalendarRange: (from: string, to: string) => Promise<void>
  loadMore: () => Promise<void>
  filter: TaskFilter
  quickAddOpen: boolean
  quickAddInitial: string
  quickAddDate: string | null
  selectMode: boolean
  selectedIds: string[]
  searchOpen: boolean
  settingsOpen: boolean
  toast: string
  setFilter: (f: TaskFilter) => void
  setView: (type: ViewKey, opts?: { listId?: string; tagId?: string; title?: string }) => Promise<void>
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
  openQuickAdd: (text?: string, date?: string) => void
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
  selectMode: false,
  selectedIds: [],
  searchOpen: false,
  settingsOpen: false,
  toast: '',

  setFilter: (filter) => set({ filter, selectedIds: [] }),

  setView: async (type, opts) => {
    if (type === 'calendar' && get().view.type === 'calendar') return
    const title =
      opts?.title ??
      ({
        today: '今天',
        upcoming: '最近 7 天',
        all: '全部',
        someday: '也许',
        completed: '已完成',
        trash: '回收站',
        calendar: '日历',
        list: '清单',
        tag: '标签'
      } as Record<ViewKey, string>)[type]
    selectionId++
    set({ view: { type, ...opts, title }, tasks: [], selected: null, filter: 'all', selectedIds: [], selectMode: false, sidebarOpen: false })
    await get().refresh()
  },

  refresh: async () => {
    const { view, calendarRange } = get()
    const request = ++refreshId
    // The mounted calendar supplies its visible range. Never load the entire
    // historical database while waiting for that first range.
    if (view.type === 'calendar' && !calendarRange) {
      set({ loading: true, error: '' })
      return
    }
    const limit = view.type === 'calendar' ? -1 : Math.max(get().tasks.length, 1000)
    set({ loading: true, error: '' })
    try {
      const tasks = await window.api.tasks.list({
        view: view.type,
        listId: view.listId,
        tagId: view.tagId,
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
    const request = ++refreshId
    set({ loading: true, error: '' })
    try {
      const more = await window.api.tasks.list({ view: view.type, listId: view.listId, tagId: view.tagId, limit: 1000, offset: tasks.length })
      if (request === refreshId) set({ tasks: [...tasks, ...more], loading: false, hasMore: more.length === 1000 })
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
    await window.api.tasks.setStatus(id, task.status !== 1)
    const { selected } = get()
    if (selected?.id === id) {
      set({ selected: await window.api.tasks.get(id) })
    }
    await Promise.all([get().refresh(), get().refreshSidebar()])
  },

  createTask: async (input) => {
    const task = await window.api.tasks.create(input)
    await Promise.all([get().refresh(), get().refreshSidebar()])
    return task
  },

  updateTask: async (id, patch) => {
    const task = await window.api.tasks.update(id, patch)
    const { selected } = get()
    if (selected?.id === id) set({ selected: task })
    await Promise.all([get().refresh(), get().refreshSidebar()])
    return task
  },

  deleteTask: async (id) => {
    await window.api.tasks.remove(id)
    if (get().selected?.id === id) set({ selected: null })
    await Promise.all([get().refresh(), get().refreshSidebar()])
    get().showToast('已移到回收站')
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
    const ids = get().selectedIds.filter(id => get().tasks.some(t => t.id === id && matchFilter(t, get().filter)))
    if (!ids.length) return
    for (const id of ids) await window.api.tasks.setStatus(id, true)
    set({ selectedIds: [], selectMode: false })
    await Promise.all([get().refresh(), get().refreshSidebar()])
    get().showToast(`已完成 ${ids.length} 项`)
  },

  batchDelete: async () => {
    const ids = get().selectedIds.filter(id => get().tasks.some(t => t.id === id && matchFilter(t, get().filter)))
    if (!ids.length) return
    for (const id of ids) await window.api.tasks.remove(id)
    if (get().selected && ids.includes(get().selected!.id)) set({ selected: null })
    set({ selectedIds: [], selectMode: false })
    await Promise.all([get().refresh(), get().refreshSidebar()])
    get().showToast(`已删除 ${ids.length} 项`)
  },

  batchRestore: async () => {
    const ids = get().selectedIds.filter(id => get().tasks.some(t => t.id === id && matchFilter(t, get().filter)))
    if (!ids.length) return
    for (const id of ids) await window.api.tasks.restore(id)
    set({ selectedIds: [], selectMode: false })
    await Promise.all([get().refresh(), get().refreshSidebar()])
    get().showToast(`已恢复 ${ids.length} 项`)
  },

  batchPurge: async () => {
    const ids = get().selectedIds.filter(id => get().tasks.some(t => t.id === id && matchFilter(t, get().filter)))
    if (!ids.length) return
    for (const id of ids) await window.api.tasks.purge(id)
    if (get().selected && ids.includes(get().selected!.id)) set({ selected: null })
    set({ selectedIds: [], selectMode: false })
    await Promise.all([get().refresh(), get().refreshSidebar()])
    get().showToast(`已彻底删除 ${ids.length} 项`)
  },

  openQuickAdd: (text = '', date) =>
    set({
      quickAddOpen: true,
      quickAddInitial: text,
      quickAddDate: date ?? null,
      searchOpen: false
    }),
  closeQuickAdd: () => set({ quickAddOpen: false, quickAddInitial: '', quickAddDate: null }),
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
