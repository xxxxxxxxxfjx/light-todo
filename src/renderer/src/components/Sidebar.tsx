import { useState } from 'react'
import {
  CalendarDays,
  CheckCircle2,
  Inbox,
  Layers,
  Moon,
  Plus,
  Settings,
  Sun,
  Tag as TagIcon
} from 'lucide-react'
import { useStore } from '../store'
import type { ViewKey } from '@shared/types'

const NAV: { key: ViewKey; label: string; icon: typeof Inbox }[] = [
  { key: 'inbox', label: '收件箱', icon: Inbox },
  { key: 'today', label: '今天', icon: Sun },
  { key: 'upcoming', label: '最近 7 天', icon: CalendarDays },
  { key: 'all', label: '全部', icon: Layers },
  { key: 'someday', label: '也许', icon: Moon },
  { key: 'completed', label: '已完成', icon: CheckCircle2 }
]

export function Sidebar(): React.JSX.Element {
  const { sidebar, view, setView, refreshSidebar, openQuickAdd, showToast } = useStore()
  const [creating, setCreating] = useState<'list' | 'folder' | null>(null)
  const [draft, setDraft] = useState('')

  const submit = async (): Promise<void> => {
    const name = draft.trim()
    if (!name) {
      setCreating(null)
      return
    }
    if (creating === 'list') {
      await window.api.lists.create({ name })
    } else if (creating === 'folder') {
      await window.api.folders.create(name)
    }
    setDraft('')
    setCreating(null)
    await refreshSidebar()
    showToast(creating === 'list' ? '清单已创建' : '文件夹已创建')
  }

  const groups = [
    ...sidebar.folders.map((f) => ({
      id: f.id as string | null,
      name: f.name,
      lists: sidebar.lists.filter((l) => l.folderId === f.id)
    })),
    { id: null as string | null, name: '', lists: sidebar.lists.filter((l) => !l.folderId) }
  ]

  return (
    <aside className="sidebar">
      <button className="new-task" onClick={openQuickAdd}>
        <Plus size={16} />
        <span>新建任务</span>
        <kbd>Ctrl N</kbd>
      </button>

      <nav className="nav">
        {NAV.map((item) => {
          const Icon = item.icon
          const active = view.type === item.key
          const count = sidebar.counts[item.key] ?? 0
          return (
            <button
              key={item.key}
              className={`nav-item ${active ? 'active' : ''}`}
              onClick={() =>
                setView(item.key, { title: item.label })
              }
            >
              <Icon size={16} className="nav-icon" />
              <span className="nav-label">{item.label}</span>
              {count > 0 && <span className="nav-count">{count}</span>}
            </button>
          )
        })}
      </nav>

      <div className="sb-section">
        <div className="sb-section-head">
          <span>清单</span>
          <button
            className="icon-btn"
            title="新建清单"
            onClick={() => {
              setCreating('list')
              setDraft('')
            }}
          >
            <Plus size={14} />
          </button>
        </div>

        {groups.map((g) => (
          <div key={g.id ?? 'root'} className="sb-group">
            {g.name && <div className="sb-folder">{g.name}</div>}
            {g.lists.map((l) => (
              <button
                key={l.id}
                className={`nav-item list-item ${
                  view.type === 'list' && view.listId === l.id ? 'active' : ''
                }`}
                onClick={() => setView('list', { listId: l.id, title: l.name })}
              >
                <span
                  className="list-dot"
                  style={{ background: l.color ?? 'var(--accent)' }}
                >
                  {l.icon ?? ''}
                </span>
                <span className="nav-label">{l.name}</span>
                {(l.count ?? 0) > 0 && <span className="nav-count">{l.count}</span>}
              </button>
            ))}
          </div>
        ))}

        {creating === 'list' && (
          <input
            className="inline-input"
            autoFocus
            placeholder="清单名称，回车创建"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={submit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') setCreating(null)
            }}
          />
        )}

        <button
          className="sb-add"
          onClick={() => {
            setCreating('folder')
            setDraft('')
          }}
        >
          <Plus size={13} /> 新建文件夹
        </button>
        {creating === 'folder' && (
          <input
            className="inline-input"
            autoFocus
            placeholder="文件夹名称，回车创建"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={submit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') setCreating(null)
            }}
          />
        )}
      </div>

      {sidebar.tags.length > 0 && (
        <div className="sb-section tags">
          <div className="sb-section-head">
            <span>标签</span>
          </div>
          <div className="tag-cloud">
            {sidebar.tags.map((t) => (
              <button
                key={t.id}
                className={`tag-chip ${view.type === 'tag' && view.tagId === t.id ? 'active' : ''}`}
                onClick={() => setView('tag', { tagId: t.id, title: `#${t.name}` })}
              >
                <TagIcon size={11} />
                {t.name}
                {(t.count ?? 0) > 0 && <span className="tag-count">{t.count}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="sb-foot">
        <button className="nav-item ghost" onClick={() => window.api.app.openDataDir()}>
          <Settings size={15} className="nav-icon" />
          <span className="nav-label">数据目录</span>
        </button>
      </div>
    </aside>
  )
}
