import { useEffect, useState } from 'react'
import {
  Archive,
  Download,
  FolderOpen,
  HardDrive,
  Info,
  Palette,
  Power,
  RotateCcw,
  Tag as TagIcon,
  Trash2,
  X
} from 'lucide-react'
import { useStore } from '../store'

interface Backup {
  name: string
  size: number
  time: number
}

const THEMES = [
  { key: 'system', label: '跟随系统' },
  { key: 'light', label: '浅色' },
  { key: 'dark', label: '深色' }
]

const VIEWS = [
  { key: 'today', label: '今天' },
  { key: 'upcoming', label: '最近 7 天' },
  { key: 'all', label: '全部' },
  { key: 'someday', label: '也许' }
]

export function SettingsModal(): React.JSX.Element {
  const { closeSettings, showToast, refresh, refreshSidebar, sidebar } = useStore()
  const [info, setInfo] = useState<{ version: string; dataDir: string } | null>(null)
  const [login, setLogin] = useState(false)
  const [backups, setBackups] = useState<Backup[]>([])
  const [theme, setTheme] = useState(localStorage.getItem('lighttodo.theme') ?? 'system')
  const [defaultView, setDefaultView] = useState(
    localStorage.getItem('lighttodo.defaultView') ?? 'today'
  )
  const [reminders, setReminders] = useState(true)
  const [newTag, setNewTag] = useState('')
  const [editingTag, setEditingTag] = useState<string | null>(null)
  const [tagDraft, setTagDraft] = useState('')

  const loadBackups = (): void => {
    window.api.data.backups().then(setBackups)
  }

  useEffect(() => {
    window.api.app.info().then(setInfo)
    window.api.data.getLoginItem().then(setLogin)
    window.api.settings.get('reminders_enabled').then((v) => setReminders(v !== '0'))
    loadBackups()
  }, [])

  const applyTheme = (t: string): void => {
    setTheme(t)
    localStorage.setItem('lighttodo.theme', t)
    if (t === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = t
  }

  const exportFile = async (kind: 'json' | 'md'): Promise<void> => {
    const res =
      kind === 'json'
        ? await window.api.data.exportJson()
        : await window.api.data.exportMarkdown()
    if (res.ok) showToast(`已导出到 ${res.path}`)
  }

  const addTag = async (): Promise<void> => {
    const name = newTag.trim()
    if (!name) return
    await window.api.tags.create(name)
    setNewTag('')
    await refreshSidebar()
    showToast('标签已创建')
  }

  const saveTag = async (id: string): Promise<void> => {
    const name = tagDraft.trim()
    if (name) {
      await window.api.tags.update(id, { name })
      await refreshSidebar()
      await refresh()
    }
    setEditingTag(null)
  }

  return (
    <div className="overlay" onMouseDown={closeSettings}>
      <div className="settings" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <span>设置</span>
          <button className="icon-btn" onClick={closeSettings}>
            <X size={16} />
          </button>
        </div>

        <div className="settings-body">
          <section className="set-section">
            <div className="set-title">
              <Palette size={14} /> 外观
            </div>
            <div className="set-row">
              <span className="set-label">主题</span>
              <div className="segmented">
                {THEMES.map((t) => (
                  <button
                    key={t.key}
                    className={`seg ${theme === t.key ? 'active' : ''}`}
                    onClick={() => applyTheme(t.key)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="set-row">
              <span className="set-label">启动视图</span>
              <select
                className="set-select"
                value={defaultView}
                onChange={(e) => {
                  setDefaultView(e.target.value)
                  localStorage.setItem('lighttodo.defaultView', e.target.value)
                  showToast('已设为启动视图')
                }}
              >
                {VIEWS.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="set-section">
            <div className="set-title">
              <TagIcon size={14} /> 标签管理
            </div>
            <div className="tag-manage">
              {sidebar.tags.length === 0 && <div className="set-hint">还没有标签</div>}
              {sidebar.tags.map((t) => (
                <div key={t.id} className="tag-manage-row">
                  {editingTag === t.id ? (
                    <input
                      className="inline-input"
                      autoFocus
                      value={tagDraft}
                      onChange={(e) => setTagDraft(e.target.value)}
                      onBlur={() => saveTag(t.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveTag(t.id)
                        if (e.key === 'Escape') setEditingTag(null)
                      }}
                    />
                  ) : (
                    <span className="tag-manage-name">#{t.name}</span>
                  )}
                  <em>{t.count ?? 0} 项</em>
                  <button
                    className="mini-btn"
                    onClick={() => {
                      setEditingTag(t.id)
                      setTagDraft(t.name)
                    }}
                  >
                    重命名
                  </button>
                  <button
                    className="mini-btn danger"
                    onClick={async () => {
                      if (!window.confirm(`删除标签「${t.name}」？任务不会被删除。`)) return
                      await window.api.tags.remove(t.id)
                      await refreshSidebar()
                      await refresh()
                      showToast('标签已删除')
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <div className="tag-add">
                <input
                  value={newTag}
                  placeholder="新标签名称"
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addTag()
                  }}
                />
                <button className="mini-btn" onClick={addTag}>
                  添加
                </button>
              </div>
            </div>
          </section>

          <section className="set-section">
            <div className="set-title">
              <HardDrive size={14} /> 数据
            </div>
            <div className="set-row">
              <span className="set-label">数据目录</span>
              <code className="set-path">{info?.dataDir ?? '…'}</code>
              <button className="mini-btn" onClick={() => window.api.app.openDataDir()}>
                <FolderOpen size={12} /> 打开
              </button>
            </div>
            <div className="set-row">
              <span className="set-label">导出</span>
              <button className="mini-btn" onClick={() => exportFile('json')}>
                <Download size={12} /> JSON
              </button>
              <button className="mini-btn" onClick={() => exportFile('md')}>
                <Download size={12} /> Markdown
              </button>
            </div>
            <div className="set-row">
              <span className="set-label">导入</span>
              <button
                className="mini-btn"
                onClick={async () => {
                  const r = await window.api.data.import()
                  if (r.ok) {
                    showToast(`已导入 ${r.tasks} 条任务、${r.lists} 个清单`)
                    await Promise.all([refresh(), refreshSidebar()])
                  } else if (r.message !== '已取消') {
                    showToast(`导入失败：${r.message ?? '未知错误'}`)
                  }
                }}
              >
                <Download size={12} /> JSON / CSV
              </button>
              <span className="set-hint">支持轻单 JSON、TickTick 与 Todoist CSV</span>
            </div>
            <div className="set-row">
              <span className="set-label">备份</span>
              <button
                className="mini-btn"
                onClick={async () => {
                  const r = await window.api.data.backup()
                  loadBackups()
                  showToast(r.ok ? '已创建备份' : '备份失败')
                }}
              >
                <Archive size={12} /> 立即备份
              </button>
              <button className="mini-btn" onClick={() => window.api.data.openBackups()}>
                <FolderOpen size={12} /> 备份目录
              </button>
              <button
                className="mini-btn danger"
                onClick={async () => {
                  if (!window.confirm('清空所有已完成任务？此操作不可撤销。')) return
                  const n = await window.api.data.clearCompleted()
                  await Promise.all([refresh(), refreshSidebar()])
                  showToast(`已清空 ${n} 条已完成任务`)
                }}
              >
                <Trash2 size={12} /> 清空已完成
              </button>
            </div>
            {backups.length > 0 && (
              <div className="backup-list">
                {backups.slice(0, 4).map((b) => (
                  <div key={b.name} className="backup-item">
                    <span>{b.name}</span>
                    <em>{(b.size / 1024).toFixed(0)} KB</em>
                    <button
                      className="mini-btn"
                      title="恢复此备份"
                      onClick={async () => {
                        if (!window.confirm('恢复后将覆盖当前数据并重启应用，继续？')) return
                        const r = await window.api.data.restoreBackup(b.name)
                        if (!r.ok) showToast('恢复失败：' + (r.message ?? '未知错误'))
                      }}
                    >
                      <RotateCcw size={12} /> 恢复
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="set-section">
            <div className="set-title">
              <Power size={14} /> 启动与提醒
            </div>
            <label className="set-row clickable">
              <span className="set-label">开机自启</span>
              <input
                type="checkbox"
                checked={login}
                onChange={async (e) => {
                  const v = await window.api.data.setLoginItem(e.target.checked)
                  setLogin(v)
                  showToast(v ? '已开启开机自启' : '已关闭开机自启')
                }}
              />
              <span className="set-hint">启动后静默驻留托盘</span>
            </label>
            <label className="set-row clickable">
              <span className="set-label">任务提醒</span>
              <input
                type="checkbox"
                checked={reminders}
                onChange={async (e) => {
                  setReminders(e.target.checked)
                  await window.api.settings.set('reminders_enabled', e.target.checked ? '1' : '0')
                  showToast(e.target.checked ? '已开启任务提醒' : '已关闭任务提醒')
                }}
              />
              <span className="set-hint">到点弹出 Windows 通知</span>
            </label>
          </section>

          <section className="set-section">
            <div className="set-title">
              <Info size={14} /> 关于
            </div>
            <div className="about">
              <div className="about-logo">✓</div>
              <div>
                <div className="about-name">轻单 LightTodo</div>
                <div className="set-hint">
                  v{info?.version ?? '0.1.0'} · Electron + React + SQLite · 本地优先
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="settings-foot">
          <span className="set-hint">快捷键：Ctrl+Shift+Space 记一条 · Ctrl+K 搜索</span>
          <button className="primary-btn" onClick={closeSettings}>
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
