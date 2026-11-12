import { Check, ChevronDown, ChevronRight, Pencil, Plus, RotateCcw, Sparkles, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useStore, type TaskFilter } from '../store'
import { TaskRow } from './TaskRow'
import { DayReport } from './DayReport'
import { addDays, differenceInCalendarDays, format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { parseLocalDate } from '../lib/format'
import { isOverdue, matchFilter } from '../lib/task-filter'
import { globalCaptureLabel } from '../lib/platform'
import type { ListSection, Task, ViewKey } from '@shared/types'

const FILTERS: { key: TaskFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'today', label: '今天' },
  { key: 'overdue', label: '逾期' },
  { key: 'high', label: '高优先级' },
  { key: 'nodate', label: '无日期' }
]

const FILTERS_BY_VIEW: Record<string, TaskFilter[]> = {
  inbox: ['all', 'high', 'nodate'],
  today: ['all', 'today', 'overdue', 'high', 'nodate'],
  upcoming: ['all', 'high'],
  all: ['all', 'today', 'overdue', 'high', 'nodate'],
  someday: ['all', 'high'],
  list: ['all', 'today', 'overdue', 'high', 'nodate'],
  tag: ['all', 'today', 'overdue', 'high', 'nodate']
}

/** Small lists keep the original DOM; only larger ones are virtualized. */
const VIRTUAL_THRESHOLD = 150
const VIRTUAL_OVERSCAN = 10
const SECTION_HEIGHT_ESTIMATE = 38
const TASK_HEIGHT_ESTIMATE = 68
const REPORT_HEIGHT_ESTIMATE = 38

type TaskSection = { key: string; label: string; tasks: Task[]; count?: number }

type TaskListItem =
  | { kind: 'section'; key: string; label: string; count: number; overdue: boolean; collapsible?: boolean; collapsed?: boolean }
  | { kind: 'task'; key: string; task: Task }
  | { kind: 'report'; key: string; dateKey: string; tasks: Task[] }

/** 只有真正的日期分组才生成日报；“无日期”分组跳过。 */
function isDateKey(key: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(key)
}

function dayKey(t: Task): string {
  if (t.scheduledDate) return t.scheduledDate
  if (t.dueAt) {
    const d = new Date(t.dueAt)
    if (!Number.isNaN(d.getTime())) return format(d, 'yyyy-MM-dd')
  }
  return 'none'
}

function dayTitle(key: string): string {
  if (key === 'none') return '无日期'
  const d = parseLocalDate(key)
  if (Number.isNaN(d.getTime())) return '日期无效'
  const diff = differenceInCalendarDays(d, new Date())
  const w = format(d, 'EEEE', { locale: zhCN })
  if (diff === 0) return `今天 · ${w}`
  if (diff === 1) return `明天 · ${w}`
  return format(d, 'M月d日 EEEE', { locale: zhCN })
}

function buildSections(
  visible: Task[],
  viewType: ViewKey,
  listSections: ListSection[] = [],
  collapsed: Set<string> = new Set()
): TaskSection[] {
  let sections: TaskSection[] = []

  if (viewType === 'list' && listSections.length) {
    const bySection = new Map<string, Task[]>()
    for (const task of visible) {
      const key = task.sectionId ?? 'none'
      if (!bySection.has(key)) bySection.set(key, [])
      bySection.get(key)!.push(task)
    }
    sections = listSections.map((section) => {
      const all = bySection.get(section.id) ?? []
      return {
        key: section.id,
        label: section.name,
        tasks: collapsed.has(section.id) ? [] : all,
        count: all.length
      }
    })
    const unassigned = bySection.get('none') ?? []
    if (unassigned.length) {
      sections.push({ key: 'none', label: '未分区', tasks: unassigned, count: unassigned.length })
    }
  } else if (viewType === 'today') {
    const overdue = visible.filter(isOverdue)
    const scheduled = visible.filter((t) => !isOverdue(t) && (t.scheduledDate || t.dueAt))
    const unscheduled = visible.filter((t) => !t.scheduledDate && !t.dueAt)
    if (overdue.length) sections.push({ key: 'overdue', label: '逾期', tasks: overdue })
    if (scheduled.length) sections.push({ key: 'today', label: '今天', tasks: scheduled })
    if (unscheduled.length) sections.push({ key: 'unscheduled', label: '待安排', tasks: unscheduled })
  } else if (viewType === 'upcoming' || viewType === 'completed') {
    const map = new Map<string, Task[]>()
    for (const t of visible) {
      const key =
        viewType === 'completed' && t.completedAt && !Number.isNaN(new Date(t.completedAt).getTime())
          ? format(new Date(t.completedAt), 'yyyy-MM-dd')
          : dayKey(t)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(t)
    }
    sections = [...map.entries()].map(([key, list]) => ({
      key,
      label: dayTitle(key),
      tasks: list
    }))
    if (viewType === 'upcoming') {
      sections.sort((a, b) => {
        if (a.key === 'none') return 1
        if (b.key === 'none') return -1
        return a.key.localeCompare(b.key)
      })
    }
  } else {
    sections = visible.length ? [{ key: 'all', label: '', tasks: visible }] : []
  }

  return sections
}

function flattenSections(sections: TaskSection[], withReport: boolean, sectionMode = false): TaskListItem[] {
  const items: TaskListItem[] = []
  for (const section of sections) {
    if (section.label) {
      const total = section.count ?? section.tasks.length
      items.push({
        kind: 'section',
        key: section.key,
        label: section.label,
        count: total,
        overdue: section.key === 'overdue',
        collapsible: sectionMode,
        collapsed: sectionMode && total > 0 && section.tasks.length === 0
      })
    }
    for (const task of section.tasks) {
      items.push({ kind: 'task', key: task.id, task })
    }
    if (withReport && isDateKey(section.key) && section.tasks.length > 0) {
      items.push({
        kind: 'report',
        key: `report:${section.key}`,
        dateKey: section.key,
        tasks: section.tasks
      })
    }
  }
  return items
}

export function TaskList(): React.JSX.Element {
  const {
    tasks,
    view,
    loading,
    error,
    hasMore,
    loadMore,
    refresh,
    openQuickAdd,
    selected,
    filter,
    setFilter,
    restoreTask,
    purgeTask,
    selectMode,
    selectedIds,
    toggleSelectMode,
    toggleSelectId,
    selectAll,
    clearSelection,
    batchComplete,
    batchDelete,
    batchRestore,
    batchPurge,
    batchBusy,
    showToast,
    sections: listSections,
    loadSections,
    updateTask,
    openReplan
  } = useStore()

  const scrollRef = useRef<HTMLDivElement>(null)
  const [openReports, setOpenReports] = useState<Set<string>>(() => new Set())
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set())
  const [addingSection, setAddingSection] = useState(false)
  const [sectionDraft, setSectionDraft] = useState('')
  const [workHours, setWorkHours] = useState({ start: '09:00', end: '18:00' })
  const [overdueCount, setOverdueCount] = useState(0)

  useEffect(() => {
    if (view.type === 'list' && view.listId) void loadSections(view.listId)
  }, [view.type, view.listId, loadSections])

  useEffect(() => {
    setCollapsedSections(new Set(listSections.filter((section) => section.collapsed).map((section) => section.id)))
  }, [listSections])

  useEffect(() => {
    const load = (): void => {
      Promise.all([
        window.api.settings.get('work_hours_start'),
        window.api.settings.get('work_hours_end')
      ])
        .then(([start, end]) => setWorkHours({ start: start ?? '09:00', end: end ?? '18:00' }))
        .catch(() => undefined)
    }
    load()
    window.addEventListener('lighttodo:work-hours', load)
    return () => window.removeEventListener('lighttodo:work-hours', load)
  }, [])

  useEffect(() => {
    if (view.type !== 'today') return
    window.api.replan
      .list()
      .then((rows) => setOverdueCount(rows.length))
      .catch(() => setOverdueCount(0))
  }, [view.type, tasks])

  const createSection = async (): Promise<void> => {
    const name = sectionDraft.trim()
    if (!name || !view.listId) {
      setAddingSection(false)
      return
    }
    try {
      await window.api.sections.create(view.listId, name)
      setSectionDraft('')
      setAddingSection(false)
      await loadSections(view.listId)
      showToast('分区已创建')
    } catch (error) {
      showToast(`创建分区失败：${String(error)}`)
    }
  }

  const toggleSection = async (section: ListSection): Promise<void> => {
    const next = new Set(collapsedSections)
    if (next.has(section.id)) next.delete(section.id)
    else next.add(section.id)
    setCollapsedSections(next)
    try {
      await window.api.sections.update(section.id, { collapsed: next.has(section.id) })
    } catch {
      /* collapsing is only a view preference */
    }
  }

  const renameSection = async (section: ListSection): Promise<void> => {
    const name = window.prompt('分区名称', section.name)?.trim()
    if (!name || name === section.name) return
    await window.api.sections.update(section.id, { name })
    if (view.listId) await loadSections(view.listId)
  }

  const removeSection = async (section: ListSection): Promise<void> => {
    if (!window.confirm(`删除分区「${section.name}」？分区里的任务会回到未分区，不会删除。`)) return
    await window.api.sections.remove(section.id)
    if (view.listId) await loadSections(view.listId)
    await refresh()
  }

  const dropOnSection = async (event: DragEvent<HTMLDivElement>, section: TaskSection): Promise<void> => {
    event.preventDefault()
    const id = event.dataTransfer.getData('text/lighttodo-task')
    if (!id) return
    await updateTask(id, { sectionId: section.key === 'none' ? null : section.key })
    showToast(`已移到「${section.label}」`)
  }

  const toggleSectionByKey = (key: string): void => {
    const section = listSections.find((item) => item.id === key)
    if (section) void toggleSection(section)
  }

  const sectionHead = (item: {
    key: string
    label: string
    count: number
    overdue?: boolean
    collapsible?: boolean
    collapsed?: boolean
  }): React.JSX.Element => (
    <div
      className={`section-head ${item.overdue ? 'overdue' : ''} ${item.collapsible ? 'section-head-list' : ''}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('text/lighttodo-task')) event.preventDefault()
      }}
      onDrop={(event) => void dropOnSection(event, { key: item.key, label: item.label, tasks: [], count: item.count })}
    >
      {item.collapsible && (
        <button
          className="section-toggle"
          aria-label={item.collapsed ? '展开分区' : '折叠分区'}
          onClick={() => toggleSectionByKey(item.key)}
        >
          {item.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
      )}
      <span className="section-name">{item.label}</span>
      <span className="section-count">{item.count}</span>
      {item.collapsible && item.key !== 'none' && (
        <span className="section-actions">
          <button
            className="section-action"
            title="重命名分区"
            onClick={() => {
              const section = listSections.find((row) => row.id === item.key)
              if (section) void renameSection(section)
            }}
          >
            <Pencil size={11} />
          </button>
          <button
            className="section-action"
            title="删除分区"
            onClick={() => {
              const section = listSections.find((row) => row.id === item.key)
              if (section) void removeSection(section)
            }}
          >
            <X size={12} />
          </button>
        </span>
      )}
    </div>
  )

  const toggleReport = useCallback((dateKey: string) => {
    setOpenReports((previous) => {
      const next = new Set(previous)
      if (next.has(dateKey)) next.delete(dateKey)
      else next.add(dateKey)
      return next
    })
  }, [])

  const visible = useMemo(() => tasks.filter((t) => matchFilter(t, filter)), [tasks, filter])
  const sections = useMemo(
    () => buildSections(visible, view.type, listSections, collapsedSections),
    [visible, view.type, listSections, collapsedSections]
  )
  const isVirtual = view.type !== 'trash' && visible.length > VIRTUAL_THRESHOLD
  const virtualItems = useMemo(
    () => (isVirtual ? flattenSections(sections, view.type === 'completed', view.type === 'list') : []),
    [isVirtual, sections, view.type]
  )

  const getScrollElement = useCallback(() => scrollRef.current, [])
  const estimateSize = useCallback(
    (index: number) => {
      const item = virtualItems[index]
      if (item?.kind === 'section') return SECTION_HEIGHT_ESTIMATE
      if (item?.kind === 'report') return REPORT_HEIGHT_ESTIMATE
      return TASK_HEIGHT_ESTIMATE
    },
    [virtualItems]
  )
  const getItemKey = useCallback(
    (index: number) => {
      const item = virtualItems[index]
      if (!item) return `missing:${index}`
      if (item.kind === 'section') return `section:${item.key}`
      if (item.kind === 'report') return `report:${item.dateKey}`
      return `task:${item.task.id}`
    },
    [virtualItems]
  )

  const virtualizer = useVirtualizer({
    count: isVirtual ? virtualItems.length : 0,
    getScrollElement,
    estimateSize,
    getItemKey,
    overscan: VIRTUAL_OVERSCAN
  })

  // The virtual branch only mounts a window of rows, so reset the scroller when
  // the user switches view/filter (including the async refresh that follows).
  const viewKey = `${view.type}|${view.listId ?? ''}|${view.tagId ?? ''}|${filter}`
  useLayoutEffect(() => {
    if (!isVirtual) return
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [viewKey, isVirtual])

  const filterHidesAll = !loading && visible.length === 0 && tasks.length > 0 && filter !== 'all'
  const visibleFilters = FILTERS.filter((f) =>
    (FILTERS_BY_VIEW[view.type] ?? ['all']).includes(f.key)
  )

  const estimateSum = tasks
    .filter((task) => task.status === 0)
    .reduce((sum, task) => sum + (task.estimateMin ?? 0), 0)
  const actualSum = tasks.reduce((sum, task) => sum + (task.actualMin ?? 0), 0)
  const toMinutes = (value: string): number => {
    const [h, m] = value.split(':').map(Number)
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
  }
  const capacityMinutes = Math.max(0, toMinutes(workHours.end) - toMinutes(workHours.start))
  const capacityRatio = capacityMinutes > 0 ? estimateSum / capacityMinutes : 0
  const capacityLabel = (minutes: number): string => {
    if (!minutes) return '0m'
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return hours ? `${hours}h${rest ? `${rest}m` : ''}` : `${rest}m`
  }

  const pushLowPriority = async (): Promise<void> => {
    const today = format(new Date(), 'yyyy-MM-dd')
    const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd')
    const targets = tasks.filter(
      (task) =>
        task.status === 0 &&
        task.scheduledDate === today &&
        task.priority <= 1
    )
    if (!targets.length) {
      showToast('今天没有可推走的低优先级任务')
      return
    }
    for (const task of targets) {
      await updateTask(task.id, { scheduledDate: tomorrow })
    }
    showToast(`已把 ${targets.length} 项低优先级任务推到明天`)
  }

  const errorBanner = error ? (
    <div className="list-error" role="alert">
      {error}{' '}
      <button className="mini-btn" onClick={() => refresh()}>
        重试
      </button>
    </div>
  ) : null

  return (
    <section className="main">
      <header className="main-head">
        <div className="main-title">
          <h1>{view.title}</h1>
          <span className="main-count">
            {view.type === 'completed'
              ? `${visible.length}${hasMore ? '+' : ''} 条记录`
              : view.type === 'trash'
                ? `${visible.length}${hasMore ? '+' : ''} 条已删除`
                : `${visible.length}${hasMore ? '+' : ''} 项`}
          </span>
          {view.type === 'today' && estimateSum > 0 && capacityMinutes > 0 && (
            <span className="capacity-pill-wrap">
              <button
                type="button"
                className={`capacity-pill ${capacityRatio > 1 ? 'over' : capacityRatio > 0.8 ? 'warn' : ''}`}
                aria-label={`今日已排 ${capacityLabel(estimateSum)}，可用 ${capacityLabel(capacityMinutes)}`}
              >
                <span className="capacity-pill-track">
                  <span style={{ width: `${Math.min(100, Math.round(capacityRatio * 100))}%` }} />
                </span>
                <span className="capacity-pill-text">
                  {capacityLabel(estimateSum)}/{capacityLabel(capacityMinutes)}
                </span>
              </button>
              <span className="capacity-pop" role="tooltip">
                <span className="capacity-pop-head">今天的容量</span>
                <span className="capacity-pop-row">
                  <span>已排</span>
                  <strong>{capacityLabel(estimateSum)}</strong>
                </span>
                <span className="capacity-pop-row">
                  <span>可用</span>
                  <strong>{capacityLabel(capacityMinutes)}</strong>
                </span>
                <span className="capacity-pop-row">
                  <span>实际</span>
                  <strong>{capacityLabel(actualSum)}</strong>
                </span>
                <span className="capacity-pop-track">
                  <i style={{ width: `${Math.min(100, Math.round(capacityRatio * 100))}%` }} />
                </span>
                {capacityRatio > 0.8 && (
                  <button className="capacity-pop-action" onClick={() => void pushLowPriority()}>
                    低优先级推到明天
                  </button>
                )}
              </span>
            </span>
          )}
        </div>
        <div className="head-actions">
          {view.type === 'today' && overdueCount > 0 && (
            <button className="ghost-btn overdue-btn" onClick={openReplan}>
              清理逾期 {overdueCount}
            </button>
          )}
          {view.type === 'list' && (
            <button className="ghost-btn" onClick={() => setAddingSection(true)}>
              新建分区
            </button>
          )}
          <button
            className={`ghost-btn ${selectMode ? 'active' : ''}`}
            onClick={toggleSelectMode}
          >
            {selectMode ? '退出多选' : '多选'}
          </button>
          {!['completed', 'trash'].includes(view.type) && (
            <button className="ghost-btn" onClick={() => openQuickAdd()}>
              <Plus size={15} />
              添加任务
            </button>
          )}
        </div>
      </header>

      {addingSection && view.type === 'list' && (
        <div className="section-create">
          <input
            autoFocus
            className="inline-input"
            placeholder="分区名称，如：本周 / 下周 / 以后"
            value={sectionDraft}
            onChange={(event) => setSectionDraft(event.target.value)}
            onBlur={() => void createSection()}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              if (event.key === 'Enter') void createSection()
              if (event.key === 'Escape') {
                setAddingSection(false)
                setSectionDraft('')
              }
            }}
          />
        </div>
      )}

      {selectMode && (
        <div className="bulk-bar" aria-busy={batchBusy}>
          <span>{batchBusy ? '正在处理…' : `已选 ${selectedIds.length} 项`}</span>
          <button className="mini-btn" onClick={selectAll} disabled={batchBusy}>
            全选
          </button>
          {view.type === 'trash' ? (
            <>
              <button
                className="mini-btn"
                disabled={!selectedIds.length || batchBusy}
                onClick={() => batchRestore()}
              >
                恢复
              </button>
              <button
                className="mini-btn danger"
                disabled={!selectedIds.length || batchBusy}
                onClick={() => {
                  if (window.confirm(`彻底删除选中的 ${selectedIds.length} 项？此操作不可撤销。`)) {
                    batchPurge()
                  }
                }}
              >
                彻底删除
              </button>
            </>
          ) : (
            <>
              {view.type !== 'completed' && (
                <button
                  className="mini-btn"
                  disabled={!selectedIds.length || batchBusy}
                  onClick={() => batchComplete()}
                >
                  完成
                </button>
              )}
              <button
                className="mini-btn danger"
                disabled={!selectedIds.length || batchBusy}
                onClick={() => {
                  if (window.confirm(`把选中的 ${selectedIds.length} 项移到回收站？`)) {
                    batchDelete()
                  }
                }}
              >
                删除
              </button>
            </>
          )}
          <button className="mini-btn" onClick={clearSelection} disabled={batchBusy}>
            取消
          </button>
        </div>
      )}

      {!['trash', 'completed', 'calendar'].includes(view.type) && (
        <div className="filter-bar" role="group" aria-label="筛选任务">
          <span className="filter-label">筛选</span>
          {visibleFilters.map((f) => (
            <button
              key={f.key}
              className={`filter-chip ${filter === f.key ? 'active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {view.type === 'inbox' && (
        <div className="view-hint">
          收件箱只放未分类、未排期的任务 · 选中后按 T 今天 / M 明天 / S 也许
        </div>
      )}

      {view.type === 'someday' && (
        <div className="view-hint">这里放暂时不安排日期的想法，不会进入「今天」。</div>
      )}

      {/* In virtual mode this banner sits above the scroller so the virtual
          container stays anchored at the top of the scroll content. */}
      {isVirtual && errorBanner}

      <div
        ref={scrollRef}
        className="task-scroll"
        data-virtualized={isVirtual ? 'true' : 'false'}
        data-total-rows={isVirtual ? visible.length : undefined}
      >
        {!isVirtual && errorBanner}
        {loading && visible.length === 0 && <div className="list-loading">加载中…</div>}

        {!loading && !error && visible.length === 0 && (
          <div className="empty">
            <div className="empty-icon">
              <Sparkles size={22} />
            </div>
            <div className="empty-title">
              {filterHidesAll
                ? hasMore
                  ? '已加载范围内没有匹配'
                  : '没有符合筛选条件的任务'
                : emptyTitle(view.type)}
            </div>
            <div className="empty-sub">
              {filterHidesAll
                ? hasMore
                  ? '还有任务没有加载，继续加载可能找到匹配项。'
                  : '当前筛选把已有任务隐藏了，清除筛选即可看到它们。'
                : '按 ' + globalCaptureLabel + ' 随时记下一条，或在下方输入'}
            </div>
            {filterHidesAll ? (
              hasMore ? (
                <button className="primary-btn" onClick={() => loadMore()}>
                  加载更多任务
                </button>
              ) : (
                <button className="primary-btn" onClick={() => setFilter('all')}>
                  清除筛选
                </button>
              )
            ) : (
              view.type !== 'trash' &&
              view.type !== 'completed' && (
                <button className="primary-btn" onClick={() => openQuickAdd()}>
                  <Plus size={15} /> 新建任务
                </button>
              )
            )}
          </div>
        )}

        {view.type === 'trash' ? (
          <div className="trash-list">
            {visible.map((t) => {
              const checked = selectedIds.includes(t.id)
              return (
                <div
                  key={t.id}
                  className={`trash-row ${checked ? 'picked' : ''}`}
                  onClick={() => selectMode && toggleSelectId(t.id)}
                >
                  {selectMode ? (
                    <span className={`select-box ${checked ? 'checked' : ''}`} aria-hidden>
                      {checked && <Check size={11} strokeWidth={3} />}
                    </span>
                  ) : (
                    <Trash2 size={14} className="trash-icon" />
                  )}
                  <div className="trash-main">
                    <div className="task-title">{t.title}</div>
                    <div className="task-meta">
                      删除于 {t.deletedAt ? new Date(t.deletedAt).toLocaleString('zh-CN') : '—'}
                    </div>
                  </div>
                  {!selectMode && (
                    <>
                      <button className="mini-btn" onClick={() => restoreTask(t.id)}>
                        恢复
                      </button>
                      <button
                        className="danger-btn"
                        onClick={() => {
                          if (window.confirm(`彻底删除「${t.title}」？此操作不可撤销。`)) purgeTask(t.id)
                        }}
                      >
                        彻底删除
                      </button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        ) : isVirtual ? (
          <div className="task-virtual" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = virtualItems[virtualRow.index]
              if (!item) return null
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className={`task-virtual-item ${
                    item.kind === 'section'
                      ? 'task-virtual-section'
                      : item.kind === 'report'
                        ? 'task-virtual-report'
                        : 'task-virtual-task'
                  }`}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  {item.kind === 'section' ? (
                    sectionHead(item)
                  ) : item.kind === 'report' ? (
                    <DayReport
                      dateKey={item.dateKey}
                      tasks={item.tasks}
                      open={openReports.has(item.dateKey)}
                      onToggle={() => toggleReport(item.dateKey)}
                      onNotify={showToast}
                    />
                  ) : (
                    <TaskRow task={item.task} />
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          sections.map((s) => (
            <div key={s.key} className="task-section">
              {s.label && sectionHead({
                key: s.key,
                label: s.label,
                count: s.count ?? s.tasks.length,
                overdue: s.key === 'overdue',
                collapsible: view.type === 'list',
                collapsed: (s.count ?? 0) > 0 && s.tasks.length === 0
              })}
              <div className="rows">
                {s.tasks.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </div>
              {view.type === 'completed' && isDateKey(s.key) && s.tasks.length > 0 && (
                <DayReport
                  dateKey={s.key}
                  tasks={s.tasks}
                  open={openReports.has(s.key)}
                  onToggle={() => toggleReport(s.key)}
                  onNotify={showToast}
                />
              )}
            </div>
          ))
        )}

        {!loading && !filterHidesAll && visible.length === 0 && !['completed', 'trash'].includes(view.type) && (
          <div className="list-footnote">任务会保存在本机，退出也不会丢</div>
        )}
      </div>
      {hasMore && <button className="ghost-btn load-more" disabled={loading} onClick={() => loadMore()}>{loading ? '加载中…' : '加载更多任务'}</button>}
      {selected && <div className="list-pad" />}
    </section>
  )
}

function emptyTitle(type: string): string {
  switch (type) {
    case 'inbox':
      return '收件箱已经清空'
    case 'today':
      return '今天已经清空'
    case 'upcoming':
      return '未来 7 天没有安排'
    case 'someday':
      return '没有搁置的想法'
    case 'completed':
      return '还没有完成记录'
    case 'trash':
      return '回收站是空的'
    case 'filter':
      return '没有符合过滤器的任务'
    default:
      return '这里还没有任务'
  }
}
