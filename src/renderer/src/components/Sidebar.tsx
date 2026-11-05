import { useState } from 'react'
import {
  Calendar,
  CalendarDays,
  CheckCircle2,
  Layers,
  MoreHorizontal,
  Moon,
  Pencil,
  Plus,
  Settings,
  Sun,
  Tag as TagIcon,
  Trash2
} from 'lucide-react'
import { useStore } from '../store'
import type { ViewKey } from '@shared/types'

const NAV: { key: ViewKey; label: string; icon: typeof Sun }[] = [
  { key: 'today', label: '今天', icon: Sun },
  { key: 'upcoming', label: '最近 7 天', icon: CalendarDays },
  { key: 'calendar', label: '日历', icon: Calendar },
  { key: 'all', label: '全部', icon: Layers },
  { key: 'someday', label: '也许', icon: Moon },
  { key: 'completed', label: '已完成', icon: CheckCircle2 },
  { key: 'trash', label: '回收站', icon: Trash2 }
]

export function Sidebar(): React.JSX.Element {
  const { sidebar, view, setView, refreshSidebar, openQuickAdd, openSettings, showToast } = useStore()
  const [creating, setCreating] = useState<'list' | 'folder' | null>(null)
  const [draft, setDraft] = useState('')
  const [menuListId, setMenuListId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

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

  const startRename = (id: string, name: string): void => {
    setRenamingId(id)
    setRenameDraft(name)
    setMenuListId(null)
  }

  const commitRename = async (): Promise<void> => {
    const name = renameDraft.trim()
    if (renamingId && name) {
      await window.api.lists.update(renamingId, { name })
      await refreshSidebar()
      if (view.type === 'list' && view.listId === renamingId) {
        setView('list', { listId: renamingId, title: name })
      }
    }
    setRenamingId(null)
  }

  const removeList = async (id: string, name: string): Promise<void> => {
    if (!window.confirm(`删除清单「${name}」？清单里的任务会变为未分类。`)) return
    await window.api.lists.remove(id)
    setMenuListId(null)
    await refreshSidebar()
    if (view.type === 'list' && view.listId === id) {
      setView('all', { title: '全部' })
    }
    showToast('清单已删除')
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
      <button className="new-task" onClick={() => openQuickAdd()}>
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
              onClick={() => setView(item.key, { title: item.label })}
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
              <div key={l.id} className="list-row">
                {renamingId === l.id ? (
                  <input
                    className="inline-input"
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                  />
                ) : (
                  <>
                    <button
                      className={`nav-item list-item ${
                        view.type === 'list' && view.listId === l.id ? 'active' : ''
                      }`}
                      onClick={() => setView('list', { listId: l.id, title: l.name })}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setMenuListId(menuListId === l.id ? null : l.id)
                      }}
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
                    <button
                      className="list-more"
                      title="更多"
                      onClick={(e) => {
                        e.stopPropagation()
                        setMenuListId(menuListId === l.id ? null : l.id)
                      }}
                    >
                      <MoreHorizontal size={14} />
                    </button>
                    {menuListId === l.id && (
                      <div className="list-actions">
                        <button onClick={() => startRename(l.id, l.name)}>
                          <Pencil size={12} /> 重命名
                        </button>
                        <button className="danger" onClick={() => removeList(l.id, l.name)}>
                          <Trash2 size={12} /> 删除
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
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
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
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
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
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
        <button className="nav-item ghost" onClick={openSettings}>
          <Settings size={15} className="nav-icon" />
          <span className="nav-label">设置</span>
        </button>
      </div>
    </aside>
  )
}
