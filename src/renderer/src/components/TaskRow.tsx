import { memo, useEffect, useRef, useState } from 'react'
import type { DragEvent, MouseEvent } from 'react'
import { Check, Clock, Moon, Repeat } from 'lucide-react'
import { useStore } from '../store'
import { dueLabel } from '../lib/format'
import type { Task } from '@shared/types'

/** Shared with CalendarView / WeekView so task drags stay identifiable. */
const DRAG_MIME = 'text/lighttodo-task'
/** Only used to avoid drawing a drop line on the row being dragged. */
let activeDragId: string | null = null

export const TaskRow = memo(function TaskRow({ task }: { task: Task }): React.JSX.Element {
  const {
    selected,
    selectTask,
    toggleTask,
    sidebar,
    view,
    selectMode,
    selectedIds,
    toggleSelectId,
    moveTask,
    updateTask
  } = useStore()
  const [dragging, setDragging] = useState(false)
  const [dropPlace, setDropPlace] = useState<'before' | 'after' | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.title)
  const editingRef = useRef(false)
  const suppressClickRef = useRef(false)
  const suppressClickTimerRef = useRef<number | null>(null)
  const due = dueLabel(task)
  const list = sidebar.lists.find((l) => l.id === task.listId)
  const checked = selectedIds.includes(task.id)
  const active = !selectMode && selected?.id === task.id
  // Completed tasks are ordered by completed_at in the main query, so manual
  // sorting would have no visible effect there. Selection mode owns clicks.
  const canDrag = !selectMode && view.type !== 'completed'

  useEffect(() => {
    return () => {
      if (activeDragId === task.id) activeDragId = null
      if (suppressClickTimerRef.current !== null) {
        window.clearTimeout(suppressClickTimerRef.current)
      }
    }
  }, [task.id])

  const handleRowClick = (): void => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (selectMode) toggleSelectId(task.id)
    else selectTask(task.id)
  }

  const beginTitleEdit = (e: MouseEvent<HTMLSpanElement>): void => {
    e.stopPropagation()
    e.preventDefault()
    if (editingRef.current) return
    editingRef.current = true
    setDraft(task.title)
    setEditing(true)
  }

  const cancelTitleEdit = (): void => {
    editingRef.current = false
    setEditing(false)
    setDraft(task.title)
  }

  const commitTitleEdit = (): void => {
    if (!editingRef.current) return
    const next = draft.trim()
    editingRef.current = false
    setEditing(false)
    if (!next || next === task.title) {
      setDraft(task.title)
      return
    }
    setDraft(next)
    void updateTask(task.id, { title: next }).catch((error) => console.error(error))
  }

  const handleDragStart = (e: DragEvent<HTMLDivElement>): void => {
    if (!canDrag || editingRef.current) {
      e.preventDefault()
      return
    }
    activeDragId = task.id
    suppressClickRef.current = true
    if (suppressClickTimerRef.current !== null) {
      window.clearTimeout(suppressClickTimerRef.current)
      suppressClickTimerRef.current = null
    }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(DRAG_MIME, task.id)
    setDragging(true)
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>): void => {
    if (!canDrag || editingRef.current) return
    if (activeDragId === task.id || !e.dataTransfer.types.includes(DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const place = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after'
    setDropPlace((prev) => (prev === place ? prev : place))
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    const next = e.relatedTarget as Node | null
    if (next && e.currentTarget.contains(next)) return
    setDropPlace(null)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    if (!canDrag || editingRef.current) return
    e.preventDefault()
    e.stopPropagation()
    const sourceId = e.dataTransfer.getData(DRAG_MIME)
    const rect = e.currentTarget.getBoundingClientRect()
    const place = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after'
    setDropPlace(null)
    activeDragId = null
    if (!sourceId || sourceId === task.id) return
    void moveTask(sourceId, task.id, place).catch((error) => console.error(error))
  }

  const handleDragEnd = (): void => {
    activeDragId = null
    setDragging(false)
    setDropPlace(null)
    // Chromium may dispatch a click right after a drag. Keep the row click
    // suppressed through that turn, then release it in case no click arrives.
    if (suppressClickTimerRef.current !== null) {
      window.clearTimeout(suppressClickTimerRef.current)
    }
    suppressClickTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = false
      suppressClickTimerRef.current = null
    }, 200)
  }

  return (
    <div
      className={`task-row ${active ? 'selected' : ''} ${checked ? 'picked' : ''} ${
        task.status === 1 ? 'done' : ''
      } ${dragging ? 'dragging' : ''} ${dropPlace ? `drop-${dropPlace}` : ''}`}
      draggable={canDrag && !editing}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDragEnd={handleDragEnd}
      onClick={handleRowClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          if (selectMode) toggleSelectId(task.id)
          else selectTask(task.id)
        }
      }}
      role="button"
      tabIndex={0}
    >
      <span className="prio" data-p={task.priority} />
      {selectMode ? (
        <span className={`select-box ${checked ? 'checked' : ''}`} aria-hidden>
          {checked && <Check size={11} strokeWidth={3} />}
        </span>
      ) : (
        <button
          className={`check ${task.status === 1 ? 'checked' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            toggleTask(task.id)
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          aria-label={task.status === 1 ? '标记未完成' : '完成'}
        >
          <Check size={12} strokeWidth={3} />
        </button>
      )}

      <div className="task-main">
        <div className="task-title-line">
          {editing ? (
            <input
              className="task-title-input"
              value={draft}
              autoFocus
              aria-label="编辑任务标题"
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onDragStart={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={commitTitleEdit}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitTitleEdit()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  cancelTitleEdit()
                }
              }}
            />
          ) : (
            <span className="task-title" onDoubleClick={beginTitleEdit}>
              {task.title}
            </span>
          )}
          {task.subtaskCount > 0 && (
            <span className="sub-count">
              {task.subtaskDone}/{task.subtaskCount}
            </span>
          )}
        </div>
        <div className="task-meta">
          {view.type !== 'list' && list && (
            <span className="meta-chip list">
              <span className="meta-dot" style={{ background: list.color ?? 'var(--accent)' }} />
              {list.name}
            </span>
          )}
          {task.someday && view.type !== 'someday' && (
            <span className="meta-chip">
              <Moon size={11} />
              也许
            </span>
          )}
          {due.text && (
            <span className={`meta-chip due ${due.tone}`}>
              <Clock size={11} />
              {due.text}
            </span>
          )}
          {task.rrule && (
            <span className="meta-chip">
              <Repeat size={11} />
              重复
            </span>
          )}
          {task.tags.map((t) => (
            <span key={t.id} className="meta-chip tag">
              #{t.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
})
