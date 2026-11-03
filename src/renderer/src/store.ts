import { create } from 'zustand'
import type { CreateTaskInput, SidebarData, Task, UpdateTaskInput, ViewKey } from '@shared/types'

export interface ViewState {
  type: ViewKey
  listId?: string
  tagId?: string
  title: string
}

export type TaskFilter = 'all' | 'overdue' | 'today' | 'high' | 'nodate'

const EMPTY_SIDEBAR: SidebarData = { folders: [], lists: [], tags: [], counts: {} }

interface AppStore {
  view: ViewState
  tasks: Task[]
  selected: Task | null
  sidebar: SidebarData
  loading: boolean
  filter: TaskFilter
  quickAddOpen: boolean
  quickAddInitial: string
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
  openQuickAdd: (text?: string) => void
  closeQuickAdd: () => void
  openSearch: () => void
  closeSearch: () => void
  openSettings: () => void
  closeSettings: () => void
  showToast: (msg: string) => void
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useStore = create<AppStore>((set, get) => ({
  view: { type: 'today', title: '今天' },
  tasks: [],
  selected: null,
  sidebar: EMPTY_SIDEBAR,
  loading: false,
  filter: 'all',
  quickAddOpen: false,
  quickAddInitial: '',
  searchOpen: false,
  settingsOpen: false,
  toast: '',

  setFilter: (filter) => set({ filter }),

  setView: async (type, opts) => {
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
        list: '清单',
        tag: '标签'
      } as Record<ViewKey, string>)[type]
    set({ view: { type, ...opts, title }, selected: null, filter: 'all' })
    await get().refresh()
  },

  refresh: async () => {
    const { view } = get()
    set({ loading: true })
    try {
      const tasks = await window.api.tasks.list({
        view: view.type,
        listId: view.listId,
        tagId: view.tagId
      })
      set({ tasks, loading: false })
    } catch (e) {
      console.error(e)
      set({ loading: false })
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
    if (!id) {
      set({ selected: null })
      return
    }
    const task = await window.api.tasks.get(id)
    set({ selected: task })
  },

  selectTaskById: async (id) => {
    const task = await window.api.tasks.get(id)
    set({ selected: task, searchOpen: false })
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

  openQuickAdd: (text = '') => set({ quickAddOpen: true, quickAddInitial: text, searchOpen: false }),
  closeQuickAdd: () => set({ quickAddOpen: false, quickAddInitial: '' }),
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
