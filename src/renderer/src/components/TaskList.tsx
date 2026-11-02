import { Plus, Sparkles } from 'lucide-react'
import { useStore } from '../store'
import { TaskRow } from './TaskRow'
import { differenceInCalendarDays, format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { parseLocalDate } from '../lib/format'
import type { Task } from '@shared/types'

function isOverdue(t: Task): boolean {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  if (t.scheduledDate) {
    return parseLocalDate(t.scheduledDate).getTime() < todayStart.getTime()
  }
  if (t.dueAt) {
    return new Date(t.dueAt).getTime() < todayStart.getTime()
  }
  return false
}

function dayKey(t: Task): string {
  if (t.scheduledDate) return t.scheduledDate
  if (t.dueAt) return format(new Date(t.dueAt), 'yyyy-MM-dd')
  return 'none'
}

function dayTitle(key: string): string {
  if (key === 'none') return '无日期'
  const d = parseLocalDate(key)
  const diff = differenceInCalendarDays(d, new Date())
  const w = format(d, 'EEEE', { locale: zhCN })
  if (diff === 0) return `今天 · ${w}`
  if (diff === 1) return `明天 · ${w}`
  return format(d, 'M月d日 EEEE', { locale: zhCN })
}

export function TaskList(): React.JSX.Element {
  const { tasks, view, loading, openQuickAdd, selected } = useStore()

  let sections: { key: string; label: string; tasks: Task[] }[] = []

  if (view.type === 'today') {
    const overdue = tasks.filter(isOverdue)
    const rest = tasks.filter((t) => !isOverdue(t))
    if (overdue.length) sections.push({ key: 'overdue', label: '逾期', tasks: overdue })
    if (rest.length) sections.push({ key: 'today', label: '今天', tasks: rest })
  } else if (view.type === 'upcoming' || view.type === 'completed') {
    const map = new Map<string, Task[]>()
    for (const t of tasks) {
      const key =
        view.type === 'completed' && t.completedAt
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
  } else {
    sections = tasks.length ? [{ key: 'all', label: '', tasks }] : []
  }

  return (
    <section className="main">
      <header className="main-head">
        <div className="main-title">
          <h1>{view.title}</h1>
          <span className="main-count">
            {view.type === 'completed' ? `${tasks.length} 条记录` : `${tasks.length} 项`}
          </span>
        </div>
        <button className="ghost-btn" onClick={openQuickAdd}>
          <Plus size={15} />
          添加任务
        </button>
      </header>

      <div className="task-scroll">
        {loading && tasks.length === 0 && <div className="list-loading">加载中…</div>}

        {!loading && tasks.length === 0 && (
          <div className="empty">
            <div className="empty-icon">
              <Sparkles size={22} />
            </div>
            <div className="empty-title">{emptyTitle(view.type)}</div>
            <div className="empty-sub">按 Ctrl+Shift+Space 随时记下一条，或在下方输入</div>
            <button className="primary-btn" onClick={openQuickAdd}>
              <Plus size={15} /> 新建任务
            </button>
          </div>
        )}

        {sections.map((s) => (
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
        ))}

        {!loading && tasks.length === 0 && view.type !== 'completed' && (
          <div className="list-footnote">任务会保存在本机，退出也不会丢</div>
        )}
      </div>
      {selected && <div className="list-pad" />}
    </section>
  )
}

function emptyTitle(type: string): string {
  switch (type) {
    case 'inbox':
      return '收件箱是空的'
    case 'today':
      return '今天已经清空'
    case 'upcoming':
      return '未来 7 天没有安排'
    case 'someday':
      return '没有搁置的想法'
    case 'completed':
      return '还没有完成记录'
    default:
      return '这里还没有任务'
  }
}
