import { useEffect } from 'react'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { TaskList } from './components/TaskList'
import { DetailPanel } from './components/DetailPanel'
import { QuickAdd } from './components/QuickAdd'
import { SearchPalette } from './components/SearchPalette'
import { useStore } from './store'

export default function App(): React.JSX.Element {
  const {
    refresh,
    refreshSidebar,
    quickAddOpen,
    searchOpen,
    openQuickAdd,
    openSearch,
    closeQuickAdd,
    closeSearch,
    toast,
    selected,
    toggleTask,
    setView
  } = useStore()

  useEffect(() => {
    refreshSidebar()
    refresh()
    const off = window.api.onQuickAdd(() => openQuickAdd())
    return off
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
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selected, quickAddOpen, searchOpen])

  return (
    <div className="app">
      <TitleBar onSearch={openSearch} />
      <div className="shell">
        <Sidebar />
        <TaskList />
        <DetailPanel />
      </div>
      {quickAddOpen && <QuickAdd />}
      {searchOpen && <SearchPalette />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
