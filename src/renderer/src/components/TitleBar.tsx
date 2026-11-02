import { Search } from 'lucide-react'

export function TitleBar({ onSearch }: { onSearch: () => void }): React.JSX.Element {
  return (
    <header className="titlebar">
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
        <kbd>Ctrl K</kbd>
      </button>
    </header>
  )
}
