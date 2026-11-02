import { useEffect, useState } from 'react'
import { Archive, Download, FolderOpen, HardDrive, Info, Power, X } from 'lucide-react'
import { useStore } from '../store'

interface Backup {
  name: string
  size: number
  time: number
}

export function SettingsModal(): React.JSX.Element {
  const { closeSettings, showToast } = useStore()
  const [info, setInfo] = useState<{ version: string; dataDir: string } | null>(null)
  const [login, setLogin] = useState(false)
  const [backups, setBackups] = useState<Backup[]>([])

  const loadBackups = (): void => {
    window.api.data.backups().then(setBackups)
  }

  useEffect(() => {
    window.api.app.info().then(setInfo)
    window.api.data.getLoginItem().then(setLogin)
    loadBackups()
  }, [])

  const exportFile = async (kind: 'json' | 'md'): Promise<void> => {
    const res =
      kind === 'json'
        ? await window.api.data.exportJson()
        : await window.api.data.exportMarkdown()
    if (res.ok) showToast(`已导出到 ${res.path}`)
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
              <span className="set-hint">保留最近 14 份 · 每次启动/退出自动备份</span>
            </div>
            {backups.length > 0 && (
              <div className="backup-list">
                {backups.slice(0, 3).map((b) => (
                  <div key={b.name} className="backup-item">
                    <span>{b.name}</span>
                    <em>{(b.size / 1024).toFixed(0)} KB</em>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="set-section">
            <div className="set-title">
              <Power size={14} /> 启动
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
