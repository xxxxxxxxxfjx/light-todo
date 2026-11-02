import { Check, Clock, Repeat } from 'lucide-react'
import { useStore } from '../store'
import { dueLabel } from '../lib/format'
import type { Task } from '@shared/types'

export function TaskRow({ task }: { task: Task }): React.JSX.Element {
  const { selected, selectTask, toggleTask, sidebar, view } = useStore()
  const due = dueLabel(task)
  const list = sidebar.lists.find((l) => l.id === task.listId)
  const active = selected?.id === task.id

  return (
    <div
      className={`task-row ${active ? 'selected' : ''} ${task.status === 1 ? 'done' : ''}`}
      onClick={() => selectTask(task.id)}
      onDoubleClick={() => toggleTask(task.id)}
      role="button"
      tabIndex={0}
    >
      <span className="prio" data-p={task.priority} />
      <button
        className={`check ${task.status === 1 ? 'checked' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          toggleTask(task.id)
        }}
        aria-label={task.status === 1 ? '标记未完成' : '完成'}
      >
        <Check size={12} strokeWidth={3} />
      </button>

      <div className="task-main">
        <div className="task-title-line">
          <span className="task-title">{task.title}</span>
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
}
