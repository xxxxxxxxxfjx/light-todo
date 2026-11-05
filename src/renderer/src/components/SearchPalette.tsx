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
  const [searching, setSearching] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  useEffect(() => {
    let cancelled = false
    const term = q.trim()
    if (!term) {
      setResults([])
      setSearching(false)
      return
    }
    // Drop stale rows immediately; Enter must never open a previous query's task.
    setResults([])
    setActive(0)
    setSearching(true)
    const t = setTimeout(() => {
      window.api.search
        .query(term)
        .then((r) => {
          if (cancelled) return
          setResults(r)
          setActive(0)
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 140)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q])

  useEffect(() => {
    resultsRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active])

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
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
              if (e.key === 'Escape') closeSearch()
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, results.length - 1))
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              }
              if (e.key === 'Enter' && !searching && results[active]) open(results[active])
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="search-results" ref={resultsRef}>
          {q.trim() === '' && <div className="search-hint">输入关键词，搜索标题、备注和标签</div>}
          {q.trim() !== '' && searching && <div className="search-hint">搜索中…</div>}
          {q.trim() !== '' && !searching && results.length === 0 && (
            <div className="search-hint">没有找到匹配的任务</div>
          )}
          {!searching && results.length >= 60 && (
            <div className="search-hint">结果较多，仅显示前 60 条，请输入更具体的关键词</div>
          )}
          {results.map((t, i) => {
            const due = dueLabel(t)
            const list = sidebar.lists.find((l) => l.id === t.listId)
            return (
              <button
                key={t.id}
                data-index={i}
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
