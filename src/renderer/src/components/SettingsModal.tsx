import { useEffect, useState } from 'react'
import {
  Archive,
  Download,
  FolderOpen,
  HardDrive,
  Info,
  Palette,
  PawPrint,
  Power,
  RotateCcw,
  Tag as TagIcon,
  Trash2,
  X
} from 'lucide-react'
import { useStore } from '../store'
import { DEFAULT_PET_SETTINGS, type PetSettings } from '@shared/pet'
import { Mascot } from '../pet/Mascot'

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
  { key: 'inbox', label: '收件箱' },
  { key: 'today', label: '今天' },
  { key: 'upcoming', label: '最近 7 天' },
  { key: 'all', label: '全部' },
  { key: 'someday', label: '也许' }
]

export function SettingsModal(): React.JSX.Element {
  const { closeSettings, showToast, refresh, refreshSidebar, sidebar, view, setView } = useStore()
  const [info, setInfo] = useState<{ version: string; dataDir: string } | null>(null)
  const [login, setLogin] = useState(false)
  const [backups, setBackups] = useState<Backup[]>([])
  const [theme, setTheme] = useState(localStorage.getItem('lighttodo.theme') ?? 'system')
  const [defaultView, setDefaultView] = useState(() => {
    const saved = localStorage.getItem('lighttodo.defaultView') ?? 'today'
    return VIEWS.some((v) => v.key === saved) ? saved : 'today'
  })
  const [reminders, setReminders] = useState(true)
  const [newTag, setNewTag] = useState('')
  const [editingTag, setEditingTag] = useState<string | null>(null)
  const [tagDraft, setTagDraft] = useState('')
  const [pet, setPet] = useState<PetSettings>(DEFAULT_PET_SETTINGS)
  const [petReady, setPetReady] = useState(false)
  const [petSaving, setPetSaving] = useState(false)
  const [section, setSection] = useState('pet')

  const changePet = async (patch: Partial<PetSettings>): Promise<void> => {
    setPetSaving(true)
    try { setPet(await window.api.pet.setSettings(patch)) }
    catch { showToast('桌面伙伴设置失败，请重试') }
    finally { setPetSaving(false) }
  }

  const loadBackups = (): void => {
    window.api.data.backups().then(setBackups)
  }

  useEffect(() => {
    window.api.app.info().then(setInfo)
    window.api.data.getLoginItem().then(setLogin)
    window.api.settings.get('reminders_enabled').then((v) => setReminders(v !== '0'))
    loadBackups()
    window.api.pet.settings().then(value => { setPet(value); setPetReady(true) })
    return window.api.pet.onSettings(setPet)
  }, [])

  useEffect(() => {
    const dialog = document.querySelector<HTMLElement>('.settings')
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault()
        closeSettings()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = [
        ...dialog.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])'
        )
      ].filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    dialog?.querySelector<HTMLElement>('.settings-tabs button, button')?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [closeSettings])

  const applyTheme = (t: string): void => {
    setTheme(t)
    localStorage.setItem('lighttodo.theme', t)
    if (t === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = t
    window.api.app.setTheme(t as 'system' | 'light' | 'dark')
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
      if (view.type === 'tag' && view.tagId === id) {
        await setView('tag', { tagId: id, title: `#${name}` })
      }
    }
    setEditingTag(null)
  }

  return (
    <div className="overlay settings-overlay" onMouseDown={closeSettings}>
      <div className="settings" role="dialog" aria-modal="true" aria-label="设置" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <span>设置</span>
          <button className="icon-btn" aria-label="关闭设置" onClick={closeSettings}>
            <X size={16} />
          </button>
        </div>

        <nav className="settings-tabs" aria-label="设置分类">
          {[['pet', '桌面伙伴'], ['appearance', '外观与启动'], ['tags', '标签管理'], ['data', '数据与备份'], ['about', '关于']].map(([key, name]) => <button key={key} aria-current={section === key ? 'page' : undefined} className={section === key ? 'active' : ''} onClick={() => setSection(key)}>{name}</button>)}
        </nav>
        <div className="settings-body">
          <section className="set-section pet-settings" hidden={section !== 'pet'}>
            <div className="pet-settings-preview">
              <Mascot skin={pet.skin}/>
              <div><span className="pet-settings-kicker">YOUR LITTLE COMPANION</span><h2>让小可爱，陪你过好今天</h2><p>今日任务就在桌面右下角，轻轻一勾，完成一件。</p><span className="pet-settings-status">{pet.enabled ? '✦ 已开启 · 桌面置顶陪伴中' : '♡ 默认关闭 · 需要时再开启'}</span></div>
            </div>
            <fieldset disabled={!petReady || petSaving} className="pet-settings-controls">
              <div className="set-title"><PawPrint size={14}/> 桌面伙伴</div>
              <label className="set-row clickable"><span className="set-label">开启桌宠</span><input type="checkbox" role="switch" checked={pet.enabled} onChange={e => changePet({ enabled: e.target.checked })}/><span className="set-hint">默认关闭以保持启动轻快；开启后约 8 秒出现，可随时关闭</span></label>
              <div className="set-row"><span className="set-label">选择伙伴</span><div className="pet-skin-options">{(['cat', 'bunny'] as const).map(skin => <button key={skin} aria-pressed={pet.skin === skin} className={pet.skin === skin ? 'active' : ''} onClick={() => changePet({ skin })}><Mascot skin={skin}/><span>{skin === 'cat' ? '奶油猫咪' : '草莓兔兔'}</span></button>)}</div></div>
              <label className="set-row"><span className="set-label">显示大小</span><select className="set-select" value={pet.scale} onChange={e => changePet({ scale: Number(e.target.value) })}><option value="0.85">小巧 · 85%</option><option value="1">标准 · 100%</option><option value="1.15">大号 · 115%</option></select></label>
              <label className="set-row"><span className="set-label">不透明度</span><select className="set-select" value={pet.opacity} onChange={e => changePet({ opacity: Number(e.target.value) })}>{[1, .9, .8, .65, .5].map(v => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}</select></label>
              <div className="set-row"><span className="set-label">桌面位置</span><button className="mini-btn" disabled={!pet.enabled} title={!pet.enabled ? '请先开启桌宠' : '把伙伴移回屏幕右下角'} onClick={async () => { const ok = await window.api.pet.reset(); showToast(ok ? '桌面伙伴已回到右下角' : '请先开启桌宠') }}><RotateCcw size={12}/> 回到右下角</button><span className="set-hint">拖动伙伴可调整位置</span></div>
            </fieldset>
            <div className="pet-settings-note">桌宠在主窗口就绪后延迟约 8 秒加载，不影响冷启动。默认只显示小宠物，鼠标移入展开今天和逾期任务，移开后收起。列表仅用滚轮滚动；拖动宠物调整位置，右键打开菜单。</div>
          </section>
          <section className="set-section" hidden={section !== 'appearance'}>
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

          <section className="set-section" hidden={section !== 'tags'}>
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
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
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
                      if (view.type === 'tag' && view.tagId === t.id) {
                        await setView('all', { title: '全部' })
                      }
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
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                    if (e.key === 'Enter') addTag()
                  }}
                />
                <button className="mini-btn" onClick={addTag}>
                  添加
                </button>
              </div>
            </div>
          </section>

          <section className="set-section" hidden={section !== 'data'}>
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

          <section className="set-section" hidden={section !== 'appearance'}>
            <div className="set-title">
              <Power size={14} /> 启动与提醒
            </div>
            <label className="set-row clickable">
              <span className="set-label">开机自启</span>
              <input
                type="checkbox"
                checked={login}
                onChange={async (e) => {
                  const wanted = e.target.checked
                  const v = await window.api.data.setLoginItem(wanted)
                  setLogin(v)
                  showToast(
                    v === wanted
                      ? v
                        ? '已开启开机自启'
                        : '已关闭开机自启'
                      : '开机自启设置未生效，请检查系统权限'
                  )
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

          <section className="set-section" hidden={section !== 'about'}>
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
          <span className="set-hint">快捷键：Ctrl+Shift+Space 记一条 · Ctrl+F 搜索</span>
          <button className="primary-btn" onClick={closeSettings}>
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
