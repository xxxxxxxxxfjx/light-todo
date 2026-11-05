import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Calendar,
  CheckCircle2,
  Command,
  Inbox,
  Layers,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2
} from 'lucide-react'
import { useStore } from '../store'
import type { ViewKey } from '@shared/types'

type CommandItem = {
  id: string
  label: string
  hint?: string
  icon: typeof Sun
  run: () => void | Promise<void>
}

const VIEWS: { key: ViewKey; label: string; icon: typeof Sun }[] = [
  { key: 'inbox', label: '收件箱', icon: Inbox },
  { key: 'today', label: '今天', icon: Sun },
  { key: 'upcoming', label: '最近 7 天', icon: Calendar },
  { key: 'all', label: '全部', icon: Layers },
  { key: 'someday', label: '也许', icon: Moon },
  { key: 'completed', label: '已完成', icon: CheckCircle2 },
  { key: 'trash', label: '回收站', icon: Trash2 }
]

export function CommandPalette({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  const { openQuickAdd, openSearch, openSettings, setView, sidebar, showToast } = useStore()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const commands = useMemo<CommandItem[]>(() => {
    const list: CommandItem[] = [
      { id: 'new', label: '新建任务', hint: 'Ctrl+N', icon: Plus, run: () => openQuickAdd() },
      { id: 'search', label: '搜索任务', hint: 'Ctrl+F', icon: Search, run: () => openSearch() },
      {
        id: 'settings',
        label: '打开设置',
        icon: Settings,
        run: () => openSettings()
      },
      {
        id: 'export-json',
        label: '导出 JSON',
        icon: Layers,
        run: async () => {
          const result = await window.api.data.exportJson()
          if (result?.ok) showToast('已导出 JSON')
          else if (result?.message) showToast(result.message)
        }
      },
      {
        id: 'export-md',
        label: '导出 Markdown',
        icon: Layers,
        run: async () => {
          const result = await window.api.data.exportMarkdown()
          if (result?.ok) showToast('已导出 Markdown')
          else if (result?.message) showToast(result.message)
        }
      }
    ]
    for (const view of VIEWS) {
      list.push({
        id: `view-${view.key}`,
        label: `切换到${view.label}`,
        icon: view.icon,
        run: () => setView(view.key, { title: view.label })
      })
    }
    for (const listItem of sidebar.lists) {
      list.push({
        id: `list-${listItem.id}`,
        label: `打开清单：${listItem.name}`,
        icon: Layers,
        run: () => setView('list', { listId: listItem.id, title: listItem.name })
      })
    }
    return list
  }, [openQuickAdd, openSearch, openSettings, setView, sidebar.lists, showToast])

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return commands
    return commands.filter((command) => command.label.toLowerCase().includes(term))
  }, [commands, query])

  useEffect(() => {
    setActive(0)
  }, [query])

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const execute = async (command: CommandItem | undefined): Promise<void> => {
    if (!command) return
    onClose()
    await command.run()
  }

  return (
    <div className="overlay command-overlay" onMouseDown={onClose}>
      <div className="command-panel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="command-input-row">
          <Command size={17} />
          <input
            ref={inputRef}
            value={query}
            placeholder="输入命令、视图或清单名…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              if (event.key === 'Escape') onClose()
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((value) => Math.min(value + 1, filtered.length - 1))
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((value) => Math.max(value - 1, 0))
              }
              if (event.key === 'Enter') void execute(filtered[active])
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="command-list" ref={listRef}>
          {filtered.map((command, index) => {
            const Icon = command.icon
            return (
              <button
                key={command.id}
                data-index={index}
                className={`command-item ${index === active ? 'active' : ''}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => void execute(command)}
              >
                <Icon size={15} />
                <span className="command-label">{command.label}</span>
                {command.hint && <kbd>{command.hint}</kbd>}
              </button>
            )
          })}
          {!filtered.length && <div className="command-empty">没有匹配的命令</div>}
        </div>
      </div>
    </div>
  )
}
