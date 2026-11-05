import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Clock, Flag, Hash, Moon, Repeat, Tag, X } from 'lucide-react'
import { parseQuickAdd } from '@shared/nlp'
import { addDays, format } from 'date-fns'
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
    quickAddDate,
    setFilter
  } = useStore()
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [text, setText] = useState(quickAddInitial)
  const ref = useRef<HTMLTextAreaElement>(null)
  const parsed = useMemo(() => parseQuickAdd(text), [text])
  const previewSomeday =
    view.type === 'someday' && !parsed.scheduledDate && !parsed.dueAt && !quickAddDate

  useEffect(() => {
    ref.current?.focus()
  }, [])

  const submit = async (keepOpen = false): Promise<void> => {
    const title = parsed.title.trim()
    if (!title || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {

    // 清单归属：#清单名 优先，否则用当前所在的清单视图
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

    // 标签归属：当前标签视图下新增时，自动带上该标签
    const tagNames = [...parsed.tagNames]
    if (view.type === 'tag' && view.tagId) {
      const currentTag = sidebar.tags.find((t) => t.id === view.tagId)
      if (currentTag && !tagNames.includes(currentTag.name)) tagNames.push(currentTag.name)
    }

    // 日期默认：日历点选的那天 > NLP 解析 > 当前视图约定
    let scheduledDate = parsed.scheduledDate ?? quickAddDate
    if (!scheduledDate && !parsed.dueAt && view.type !== 'someday') {
      scheduledDate =
        view.type === 'upcoming'
          ? format(addDays(new Date(), 1), 'yyyy-MM-dd')
          : format(new Date(), 'yyyy-MM-dd')
    }
    const isSomeday =
      view.type === 'someday' && !scheduledDate && !parsed.dueAt

    await createTask({
      title,
      listId,
      someday: isSomeday,
      scheduledDate,
      dueAt: parsed.dueAt,
      dueAllDay: parsed.dueAllDay,
      rrule: parsed.rrule,
      repeatFrom: parsed.repeatFrom,
      priority: parsed.priority,
      tagNames
    })
    setFilter('all')
    showToast(
      isSomeday
        ? '已加入也许'
        : parsed.listName || view.type === 'list'
          ? `已添加到${parsed.listName ?? view.title}`
          : scheduledDate
            ? `已添加到 ${dateLabel(scheduledDate)}`
            : '已添加'
    )
    if (keepOpen) {
      setText('')
      ref.current?.focus()
    } else {
      closeQuickAdd()
    }
    } catch (error) {
      showToast(`添加失败：${String(error)}`)
    } finally { savingRef.current = false; setSaving(false) }
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
            placeholder={
              view.type === 'someday'
                ? '写下一个以后可能做的想法…'
                : '明天下午 3 点 交周报 #工作 @汇报 !高'
            }
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
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

        {(parsed.scheduledDate || parsed.dueAt || parsed.priority || parsed.listName || parsed.tagNames.length > 0 || parsed.rrule || quickAddDate || previewSomeday) && (
          <div className="qa-chips">
            {previewSomeday && (
              <Chip icon={Moon}>也许</Chip>
            )}
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
          <button className="qa-submit" disabled={saving} onClick={() => submit(false)}>
            {saving ? '保存中…' : '添加'}
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
