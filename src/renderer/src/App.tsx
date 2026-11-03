import { useEffect } from 'react'
import { format, addDays } from 'date-fns'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { TaskList } from './components/TaskList'
import { CalendarView } from './components/CalendarView'
import { DetailPanel } from './components/DetailPanel'
import { QuickAdd } from './components/QuickAdd'
import { SearchPalette } from './components/SearchPalette'
import { SettingsModal } from './components/SettingsModal'
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
    selected,
    toggleTask,
    setView,
    view,
    selectTaskById,
    deleteTask,
    updateTask,
    showToast
  } = useStore()

  useEffect(() => {
    refreshSidebar()
    refresh()
    const offQuick = window.api.onQuickAdd((text) => openQuickAdd(text ?? ''))
    const offOpen = window.api.onOpenTask((id) => selectTaskById(id))
    return () => {
      offQuick()
      offOpen()
    }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      const typing =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      const mod = e.ctrlKey || e.metaKey

      if (mod && e.key.toLowerCase() === 'k') {
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
      if (typing) return

      if (mod && /^[1-6]$/.test(e.key)) {
        e.preventDefault()
        const map: { key: Parameters<typeof setView>[0]; title: string }[] = [
          { key: 'inbox', title: '收件箱' },
          { key: 'today', title: '今天' },
          { key: 'upcoming', title: '最近 7 天' },
          { key: 'all', title: '全部' },
          { key: 'someday', title: '也许' },
          { key: 'completed', title: '已完成' }
        ]
        const item = map[Number(e.key) - 1]
        if (item) setView(item.key, { title: item.title })
        return
      }
      if (e.key === ' ' && selected) {
        e.preventDefault()
        toggleTask(selected.id)
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault()
        deleteTask(selected.id)
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 't' && selected) {
        e.preventDefault()
        updateTask(selected.id, { scheduledDate: format(new Date(), 'yyyy-MM-dd') })
        showToast('已安排到今天')
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'm' && selected) {
        e.preventDefault()
        updateTask(selected.id, {
          scheduledDate: format(addDays(new Date(), 1), 'yyyy-MM-dd')
        })
        showToast('已安排到明天')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selected, quickAddOpen, searchOpen, view])

  return (
    <div className="app">
      <TitleBar onSearch={openSearch} />
      <div className="shell">
        <Sidebar />
        {view.type === 'calendar' ? <CalendarView /> : <TaskList />}
        <DetailPanel />
      </div>
      {quickAddOpen && <QuickAdd />}
      {searchOpen && <SearchPalette />}
      {settingsOpen && <SettingsModal />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
