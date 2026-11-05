import { Menu, Search } from 'lucide-react'
import { useStore } from '../store'

export function TitleBar({ onSearch }: { onSearch: () => void }): React.JSX.Element {
  const { sidebarOpen, toggleSidebar } = useStore()
  return (
    <header className="titlebar">
      <button className="icon-btn navigation-toggle" aria-label="切换侧栏" aria-expanded={sidebarOpen} onClick={toggleSidebar}><Menu size={17}/></button>
      <div className="brand">
        <div className="brand-mark">
          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden>
            <path
              d="M4 12.5 9.2 17.7 20 6.9"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <span className="brand-name">轻单</span>
      </div>
      <button className="titlebar-search" onClick={onSearch} title="搜索">
        <Search size={14} />
        <span>搜索</span>
        <kbd>Ctrl F</kbd>
      </button>
    </header>
  )
}
