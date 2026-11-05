import { Check, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useStore, type TaskFilter } from '../store'
import { TaskRow } from './TaskRow'
import { differenceInCalendarDays, format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { parseLocalDate } from '../lib/format'
import { isOverdue, matchFilter } from '../lib/task-filter'
import { globalCaptureLabel } from '../lib/platform'
import type { Task, ViewKey } from '@shared/types'

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

type TaskSection = { key: string; label: string; tasks: Task[] }

type TaskListItem =
  | { kind: 'section'; key: string; label: string; count: number; overdue: boolean }
  | { kind: 'task'; key: string; task: Task }

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

function buildSections(visible: Task[], viewType: ViewKey): TaskSection[] {
  let sections: TaskSection[] = []

  if (viewType === 'today') {
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

function flattenSections(sections: TaskSection[]): TaskListItem[] {
  const items: TaskListItem[] = []
  for (const section of sections) {
    if (section.label) {
      items.push({
        kind: 'section',
        key: section.key,
        label: section.label,
        count: section.tasks.length,
        overdue: section.key === 'overdue'
      })
    }
    for (const task of section.tasks) {
      items.push({ kind: 'task', key: task.id, task })
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
    batchBusy
  } = useStore()

  const scrollRef = useRef<HTMLDivElement>(null)

  const visible = useMemo(() => tasks.filter((t) => matchFilter(t, filter)), [tasks, filter])
  const sections = useMemo(() => buildSections(visible, view.type), [visible, view.type])
  const isVirtual = view.type !== 'trash' && visible.length > VIRTUAL_THRESHOLD
  const virtualItems = useMemo(
    () => (isVirtual ? flattenSections(sections) : []),
    [isVirtual, sections]
  )

  const getScrollElement = useCallback(() => scrollRef.current, [])
  const estimateSize = useCallback(
    (index: number) =>
      virtualItems[index]?.kind === 'section' ? SECTION_HEIGHT_ESTIMATE : TASK_HEIGHT_ESTIMATE,
    [virtualItems]
  )
  const getItemKey = useCallback(
    (index: number) => {
      const item = virtualItems[index]
      if (!item) return `missing:${index}`
      return item.kind === 'section' ? `section:${item.key}` : `task:${item.task.id}`
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
        </div>
        <div className="head-actions">
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
                    item.kind === 'section' ? 'task-virtual-section' : 'task-virtual-task'
                  }`}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  {item.kind === 'section' ? (
                    <div className={`section-head ${item.overdue ? 'overdue' : ''}`}>
                      <span>{item.label}</span>
                      <span className="section-count">{item.count}</span>
                    </div>
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
              {s.label && (
                <div className={`section-head ${s.key === 'overdue' ? 'overdue' : ''}`}>
                  <span>{s.label}</span>
                  <span className="section-count">{s.tasks.length}</span>
                </div>
              )}
              <div className="rows">
                {s.tasks.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </div>
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
    default:
      return '这里还没有任务'
  }
}
