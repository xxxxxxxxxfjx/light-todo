import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Clock, Flag, Hash, Repeat, Tag, X } from 'lucide-react'
import { parseQuickAdd } from '@shared/nlp'
import { format } from 'date-fns'
import { dateLabel } from '../lib/format'
import { useStore } from '../store'

function Chip({
  icon: Icon,
  children
}: {
  icon?: typeof Clock
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span className="qa-chip">
      {Icon && <Icon size={11} />}
      {children}
    </span>
  )
}

export function QuickAdd(): React.JSX.Element {
  const {
    closeQuickAdd,
    createTask,
    sidebar,
    refreshSidebar,
    showToast,
    view,
    quickAddInitial,
    quickAddDate
  } = useStore()
  const [text, setText] = useState(quickAddInitial)
  const ref = useRef<HTMLTextAreaElement>(null)
  const parsed = useMemo(() => parseQuickAdd(text), [text])

  useEffect(() => {
    ref.current?.focus()
  }, [])

  const submit = async (keepOpen = false): Promise<void> => {
    const title = parsed.title.trim()
    if (!title) return

    // 清单归属：#清单名 优先，否则用当前所在的清单视图，否则收件箱
    let listId: string | null = null
    if (parsed.listName) {
      const found = sidebar.lists.find((l) => l.name === parsed.listName)
      if (found) {
        listId = found.id
      } else {
        const created = await window.api.lists.create({ name: parsed.listName })
        listId = created.id
        await refreshSidebar()
      }
    } else if (view.type === 'list' && view.listId) {
      listId = view.listId
    }

    // 日期默认：日历点选的那天 > NLP 解析 > 当前视图约定
    let scheduledDate = parsed.scheduledDate ?? quickAddDate
    if (!scheduledDate && !parsed.dueAt) {
      if (view.type === 'today' || view.type === 'upcoming') {
        scheduledDate = format(new Date(), 'yyyy-MM-dd')
      }
    }

    await createTask({
      title,
      listId,
      scheduledDate,
      dueAt: parsed.dueAt,
      dueAllDay: parsed.dueAllDay,
      rrule: parsed.rrule,
      repeatFrom: parsed.repeatFrom,
      priority: parsed.priority,
      tagNames: parsed.tagNames
    })
    showToast(
      parsed.listName || view.type === 'list'
        ? `已添加到${parsed.listName ?? view.title}`
        : scheduledDate
          ? `已添加到 ${dateLabel(scheduledDate)}`
          : '已添加到今天'
    )
    if (keepOpen) {
      setText('')
      ref.current?.focus()
    } else {
      closeQuickAdd()
    }
  }

  return (
    <div className="overlay" onMouseDown={closeQuickAdd}>
      <div className="qa" onMouseDown={(e) => e.stopPropagation()}>
        <div className="qa-input-row">
          <textarea
            ref={ref}
            className="qa-input"
            rows={1}
            value={text}
            placeholder="明天下午 3 点 交周报 #工作 @汇报 !高"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit(e.ctrlKey || e.metaKey)
              }
              if (e.key === 'Escape') closeQuickAdd()
            }}
          />
          <button className="icon-btn" onClick={closeQuickAdd} title="关闭">
            <X size={16} />
          </button>
        </div>

        {(parsed.scheduledDate || parsed.dueAt || parsed.priority || parsed.listName || parsed.tagNames.length > 0 || parsed.rrule || quickAddDate) && (
          <div className="qa-chips">
            {(parsed.scheduledDate || quickAddDate) && (
              <Chip icon={CalendarDays}>{dateLabel(parsed.scheduledDate ?? quickAddDate!)}</Chip>
            )}
            {parsed.dueAt && <Chip icon={Clock}>{format(new Date(parsed.dueAt), 'HH:mm')}</Chip>}
            {parsed.rrule && <Chip icon={Repeat}>{repeatLabel(parsed.rrule)}</Chip>}
            {parsed.priority > 0 && (
              <Chip icon={Flag}>{['', '低', '中', '高'][parsed.priority]}优先级</Chip>
            )}
            {parsed.listName && <Chip icon={Hash}>{parsed.listName}</Chip>}
            {parsed.tagNames.map((t) => (
              <Chip key={t} icon={Tag}>
                {t}
              </Chip>
            ))}
          </div>
        )}

        <div className="qa-foot">
          <span>
            <kbd>Enter</kbd> 保存
          </span>
          <span>
            <kbd>Ctrl</kbd> + <kbd>Enter</kbd> 继续添加
          </span>
          <span>
            <kbd>Esc</kbd> 取消
          </span>
          <span className="qa-syntax">支持：明天 / 每周一 / 每月5号 / !高 / #清单 / @标签</span>
          <button className="qa-submit" onClick={() => submit(false)}>
            添加
          </button>
        </div>
      </div>
    </div>
  )
}

function repeatLabel(rrule: string): string {
  if (rrule.includes('BYDAY=MO,TU,WE,TH,FR')) return '工作日'
  if (rrule.includes('FREQ=DAILY')) return '每天'
  if (rrule.includes('FREQ=WEEKLY')) return '每周'
  if (rrule.includes('FREQ=MONTHLY')) return '每月'
  if (rrule.includes('FREQ=YEARLY')) return '每年'
  return '重复'
}
