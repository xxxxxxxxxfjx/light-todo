import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Circle, Search } from 'lucide-react'
import { useStore } from '../store'
import { dueLabel } from '../lib/format'
import type { Task } from '@shared/types'

export function SearchPalette(): React.JSX.Element {
  const { closeSearch, selectTaskById, sidebar } = useStore()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Task[]>([])
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  useEffect(() => {
    if (!q.trim()) {
      setResults([])
      return
    }
    const t = setTimeout(() => {
      window.api.search.query(q).then((r) => {
        setResults(r)
        setActive(0)
      })
    }, 140)
    return () => clearTimeout(t)
  }, [q])

  const open = async (task: Task): Promise<void> => {
    await selectTaskById(task.id)
  }

  return (
    <div className="overlay" onMouseDown={closeSearch}>
      <div className="search-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          <Search size={17} />
          <input
            ref={ref}
            value={q}
            placeholder="搜索任务、备注、标签…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeSearch()
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, results.length - 1))
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              }
              if (e.key === 'Enter' && results[active]) open(results[active])
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="search-results">
          {q.trim() === '' && <div className="search-hint">输入关键词，搜索标题、备注和标签</div>}
          {q.trim() !== '' && results.length === 0 && (
            <div className="search-hint">没有找到匹配的任务</div>
          )}
          {results.map((t, i) => {
            const due = dueLabel(t)
            const list = sidebar.lists.find((l) => l.id === t.listId)
            return (
              <button
                key={t.id}
                className={`search-row ${i === active ? 'active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => open(t)}
              >
                {t.status === 1 ? (
                  <CheckCircle2 size={15} className="done-icon" />
                ) : (
                  <Circle size={15} />
                )}
                <span className="search-title">{t.title}</span>
                {list && <span className="search-list">{list.name}</span>}
                {due.text && <span className={`search-due ${due.tone}`}>{due.text}</span>}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
