import { useEffect, useState } from 'react'
import { format, addDays } from 'date-fns'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { TaskList } from './components/TaskList'
import { CalendarView } from './components/CalendarView'
import { WeeklyReview } from './components/WeeklyReview'
import { DetailPanel } from './components/DetailPanel'
import { QuickAdd } from './components/QuickAdd'
import { SearchPalette } from './components/SearchPalette'
import { SettingsModal } from './components/SettingsModal'
import { CommandPalette } from './components/CommandPalette'
import { useStore } from './store'

export default function App(): React.JSX.Element {
  const {
    refresh,
    refreshSidebar,
    quickAddOpen,
    searchOpen,
    settingsOpen,
    openQuickAdd,
    openSearch,
    closeQuickAdd,
    closeSearch,
    closeSettings,
    toast,
    undoLabel,
    undo,
    selected,
    selectTask,
    toggleTask,
    setView,
    view,
    selectTaskById,
    deleteTask,
    updateTask,
    showToast,
    sidebarOpen,
    closeSidebar
  } = useStore()
  const [commandOpen, setCommandOpen] = useState(false)

  useEffect(() => {
    const savedTheme = localStorage.getItem('lighttodo.theme')
    if (savedTheme === 'light' || savedTheme === 'dark') {
      document.documentElement.dataset.theme = savedTheme
      window.api.app.setTheme(savedTheme)
    } else if (savedTheme === 'system') {
      delete document.documentElement.dataset.theme
      window.api.app.setTheme('system')
    } else {
      // No local preference yet (fresh profile / restored backup): use the
      // theme persisted in SQLite instead of overwriting it with "system".
      window.api.app.info().then((info) => {
        if (info.theme === 'light' || info.theme === 'dark') {
          document.documentElement.dataset.theme = info.theme
        }
      })
    }
    refreshSidebar()
    refresh()
    const dv = localStorage.getItem('lighttodo.defaultView')
    if (dv === 'inbox' || dv === 'upcoming' || dv === 'all' || dv === 'someday') {
      setView(dv, {
        title:
          dv === 'inbox'
            ? '收件箱'
            : dv === 'upcoming'
              ? '最近 7 天'
              : dv === 'all'
                ? '全部'
                : '也许'
      })
    }
    // 托盘 / 全局快捷键 / lighttodo://add 都是“捕获”：默认进收件箱。
    const offQuick = window.api.onQuickAdd((text) => openQuickAdd(text ?? '', undefined, true))
    const offOpen = window.api.onOpenTask((id) => selectTaskById(id))
    const offSettings = window.api.onSettings(() => useStore.getState().openSettings())
    const offTasks = window.api.onTasksChanged(() => {
      refresh()
      refreshSidebar()
      const id = useStore.getState().selected?.id
      if (id) selectTaskById(id)
    })
    const reportFailure = (event: PromiseRejectionEvent): void => {
      showToast(`操作失败，请重试：${String(event.reason?.message ?? event.reason)}`)
    }
    window.addEventListener('unhandledrejection', reportFailure)
    return () => {
      offQuick()
      offOpen()
      offSettings()
      offTasks()
      window.removeEventListener('unhandledrejection', reportFailure)
    }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.isComposing || e.keyCode === 229) return
      const target = e.target instanceof HTMLElement ? e.target : document.body
      const typing =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      const control = !!target.closest(
        'input,textarea,select,button,a,[contenteditable="true"],[role="switch"],[role="checkbox"],[role="combobox"]'
      )
      const mod = e.ctrlKey || e.metaKey

      if (commandOpen) {
        if (e.key === 'Escape') {
          e.preventDefault()
          setCommandOpen(false)
        }
        return
      }
      if (settingsOpen) {
        if (e.key === 'Escape') {
          e.preventDefault()
          closeSettings()
        }
        return
      }
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        closeQuickAdd()
        closeSearch()
        setCommandOpen(true)
        return
      }
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        openSearch()
        return
      }
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        openQuickAdd()
        return
      }
      if (mod && e.key === 'Escape') {
        closeQuickAdd()
        closeSearch()
        closeSettings()
        return
      }
      if (typing || quickAddOpen || searchOpen || control) return

      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
        return
      }

      // 收件箱键盘 triage：无修饰键 T/M/S，仅作用于当前选中任务。
      if (view.type === 'inbox' && selected && !mod && !e.shiftKey && !e.altKey) {
        const key = e.key.toLowerCase()
        if (key === 't' || key === 'm' || key === 's') {
          e.preventDefault()
          if (selected.status === 1) {
            showToast('已完成的任务请先恢复再安排')
            return
          }
          if (key === 't') {
            updateTask(selected.id, { scheduledDate: format(new Date(), 'yyyy-MM-dd') })
            showToast('已安排到今天')
          } else if (key === 'm') {
            updateTask(selected.id, {
              scheduledDate: format(addDays(new Date(), 1), 'yyyy-MM-dd')
            })
            showToast('已安排到明天')
          } else {
            updateTask(selected.id, { someday: true, scheduledDate: null, dueAt: null })
            showToast('已移到也许')
          }
          return
        }
      }

      if (mod && /^[1-6]$/.test(e.key)) {
        e.preventDefault()
        const map: { key: Parameters<typeof setView>[0]; title: string }[] = [
          { key: 'today', title: '今天' },
          { key: 'upcoming', title: '最近 7 天' },
          { key: 'all', title: '全部' },
          { key: 'someday', title: '也许' },
          { key: 'completed', title: '已完成' },
          { key: 'trash', title: '回收站' }
        ]
        const item = map[Number(e.key) - 1]
        if (item) setView(item.key, { title: item.title })
        return
      }
      const taskLike =
        target === document.body ||
        target === document.documentElement ||
        !!target.closest('.task-row,.agenda-row,.week-task')
      if (e.key === ' ' && selected && taskLike) {
        e.preventDefault()
        toggleTask(selected.id)
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected && taskLike) {
        e.preventDefault()
        deleteTask(selected.id)
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 't' && selected) {
        e.preventDefault()
        if (selected.status === 1) {
          showToast('已完成的任务请先恢复再安排')
          return
        }
        updateTask(selected.id, { scheduledDate: format(new Date(), 'yyyy-MM-dd') })
        showToast('已安排到今天')
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'm' && selected) {
        e.preventDefault()
        if (selected.status === 1) {
          showToast('已完成的任务请先恢复再安排')
          return
        }
        updateTask(selected.id, {
          scheduledDate: format(addDays(new Date(), 1), 'yyyy-MM-dd')
        })
        showToast('已安排到明天')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selected, quickAddOpen, searchOpen, settingsOpen, view, commandOpen])

  useEffect(() => {
    if (!selected) return
    const closeOnUnrelatedClick = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('.detail')) return
      if (target.closest('.task-row, .cal-item, .agenda-row, .week-task, .search-row, .toast')) return
      selectTask(null)
    }
    document.addEventListener('click', closeOnUnrelatedClick)
    return () => document.removeEventListener('click', closeOnUnrelatedClick)
  }, [selected, selectTask])

  return (
    <div className="app">
      <TitleBar onSearch={openSearch} />
      <div className={`shell ${selected ? 'has-detail' : ''} ${sidebarOpen ? 'navigation-open' : ''}`}>
        {sidebarOpen && <button className="sidebar-backdrop" aria-label="关闭侧栏" onClick={closeSidebar}/>}
        <Sidebar />
        {view.type === 'calendar' ? (
          <CalendarView />
        ) : view.type === 'review' ? (
          <WeeklyReview />
        ) : (
          <TaskList />
        )}
        {((view.type !== 'calendar' && view.type !== 'review') || selected) && <DetailPanel />}
      </div>
      {quickAddOpen && <QuickAdd />}
      {searchOpen && <SearchPalette />}
      {settingsOpen && <SettingsModal />}
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />
      {toast && (
        <div className="toast">
          {toast}
          {undoLabel && (
            <button className="toast-undo" onClick={() => void undo()}>
              撤销
            </button>
          )}
        </div>
      )}
    </div>
  )
}
