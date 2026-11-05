import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Clock, Flag, Hash, Moon, Repeat, Tag, X } from 'lucide-react'
import { parseQuickAdd } from '@shared/nlp'
import { addDays, format } from 'date-fns'
import { dateLabel, parseLocalDate } from '../lib/format'
import { repeatLabel } from '../lib/repeat'
import { useStore } from '../store'
import { mod } from '../lib/platform'
import {
  TEMPLATE_SETTING_KEY,
  addTemplate,
  parseTemplates,
  removeTemplate,
  type QuickAddTemplate
} from '../lib/templates'

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
    quickAddInbox,
    setFilter
  } = useStore()
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [text, setText] = useState(quickAddInitial)
  const [templates, setTemplates] = useState<QuickAddTemplate[]>([])
  const ref = useRef<HTMLTextAreaElement>(null)
  const parsed = useMemo(() => parseQuickAdd(text), [text])
  // The calendar's picked day is the anchor: a time-only phrase such as “9:00”
  // must not silently move the task to today/tomorrow. An explicit date in the
  // text ("明天", "3月5日") still wins.
  const effective = useMemo(() => {
    if (!quickAddDate || parsed.hasExplicitDate) {
      return { scheduledDate: parsed.scheduledDate, dueAt: parsed.dueAt }
    }
    let dueAt = parsed.dueAt
    if (dueAt) {
      const base = parseLocalDate(quickAddDate)
      const time = new Date(dueAt)
      base.setHours(time.getHours(), time.getMinutes(), 0, 0)
      dueAt = base.toISOString()
    }
    return { scheduledDate: quickAddDate, dueAt }
  }, [parsed, quickAddDate])
  // 全局捕获带 inbox 标记；在收件箱视图内新建同样不补默认日期。
  const inboxMode = quickAddInbox || view.type === 'inbox'
  const previewSomeday =
    !inboxMode &&
    view.type === 'someday' &&
    !effective.scheduledDate &&
    !effective.dueAt &&
    !quickAddDate

  useEffect(() => {
    ref.current?.focus()
    window.api.settings.get(TEMPLATE_SETTING_KEY).then((raw) => setTemplates(parseTemplates(raw))).catch(() => undefined)
  }, [])

  const saveTemplate = async (): Promise<void> => {
    if (!text.trim()) return
    const next = addTemplate(templates, text)
    setTemplates(next)
    try {
      await window.api.settings.set(TEMPLATE_SETTING_KEY, JSON.stringify(next))
      showToast('已存为模板')
    } catch {
      showToast('模板保存失败')
    }
  }

  const applyTemplate = (template: QuickAddTemplate): void => {
    setText(template.text)
    ref.current?.focus()
  }

  const deleteTemplate = async (id: string): Promise<void> => {
    const next = removeTemplate(templates, id)
    setTemplates(next)
    try {
      await window.api.settings.set(TEMPLATE_SETTING_KEY, JSON.stringify(next))
    } catch {
      showToast('模板删除失败')
    }
  }

  const submit = async (keepOpen = false): Promise<void> => {
    const trimmed = text.trim()
    const title = parsed.title.trim()
    const metadataOnly =
      !!title &&
      title === trimmed &&
      !!(
        parsed.scheduledDate ||
        parsed.dueAt ||
        parsed.priority ||
        parsed.listName ||
        parsed.tagNames.length ||
        parsed.rrule
      )
    if (!title || savingRef.current) return
    if (metadataOnly) {
      showToast('请输入任务标题')
      ref.current?.focus()
      return
    }
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
    } else if (!inboxMode && view.type === 'list' && view.listId) {
      listId = view.listId
    }

    // 标签归属：当前标签视图下新增时，自动带上该标签；全局捕获不继承视图上下文。
    const tagNames = [...parsed.tagNames]
    if (!inboxMode && view.type === 'tag' && view.tagId) {
      const currentTag = sidebar.tags.find((t) => t.id === view.tagId)
      if (currentTag && !tagNames.includes(currentTag.name)) tagNames.push(currentTag.name)
    }

    // 日期默认：日历点选的那天 > NLP 解析 > 当前视图约定。
    // 收件箱 / 全局捕获 / 清单视图都不强行补今天日期。
    let scheduledDate = effective.scheduledDate
    const dueAt = effective.dueAt
    if (
      !scheduledDate &&
      !dueAt &&
      !inboxMode &&
      view.type !== 'someday' &&
      view.type !== 'list'
    ) {
      scheduledDate =
        view.type === 'upcoming'
          ? format(addDays(new Date(), 1), 'yyyy-MM-dd')
          : format(new Date(), 'yyyy-MM-dd')
    }
    const isSomeday = !inboxMode && view.type === 'someday' && !scheduledDate && !dueAt

    await createTask({
      title,
      listId,
      someday: isSomeday,
      scheduledDate,
      dueAt,
      dueAllDay: dueAt ? 0 : parsed.dueAllDay,
      rrule: parsed.rrule,
      repeatFrom: parsed.repeatFrom,
      priority: parsed.priority,
      tagNames
    })
    setFilter('all')
    showToast(
      isSomeday
        ? '已加入也许'
        : parsed.listName || (!inboxMode && view.type === 'list')
          ? `已添加到${parsed.listName ?? view.title}`
          : scheduledDate
            ? `已添加到${dateLabel(scheduledDate)}`
            : inboxMode
              ? '已添加到收件箱'
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
              inboxMode
                ? '记下一条想法，之后在收件箱里整理…'
                : view.type === 'someday'
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

        {templates.length > 0 && (
          <div className="qa-templates" aria-label="快速添加模板">
            <span className="qa-templates-label">模板</span>
            {templates.map((template) => (
              <span className="qa-template-chip" key={template.id}>
                <button className="qa-template-apply" onClick={() => applyTemplate(template)} title={template.text}>{template.name}</button>
                <button className="qa-template-remove" aria-label={`删除模板：${template.name}`} onClick={() => void deleteTemplate(template.id)}><X size={10} /></button>
              </span>
            ))}
          </div>
        )}

        {(parsed.scheduledDate || parsed.dueAt || parsed.priority || parsed.listName || parsed.tagNames.length > 0 || parsed.rrule || quickAddDate || previewSomeday) && (
          <div className="qa-chips">
            {previewSomeday && (
              <Chip icon={Moon}>也许</Chip>
            )}
            {effective.scheduledDate && (
              <Chip icon={CalendarDays}>{dateLabel(effective.scheduledDate)}</Chip>
            )}
            {effective.dueAt && <Chip icon={Clock}>{format(new Date(effective.dueAt), 'HH:mm')}</Chip>}
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
            <kbd>{mod}</kbd> + <kbd>Enter</kbd> 继续添加
          </span>
          <button className="qa-template-save" title="保存当前输入为模板" disabled={!text.trim()} onClick={() => void saveTemplate()}>存模板</button>
          <span className="qa-syntax">支持：明天 / 每周一 / !高 / #清单 / @标签</span>
          <button className="qa-submit" disabled={saving} onClick={() => submit(false)}>
            {saving ? '保存中…' : '添加'}
          </button>
        </div>
      </div>
    </div>
  )
}
