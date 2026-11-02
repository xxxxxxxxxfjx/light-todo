import { useMemo, useState } from 'react'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek
} from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useStore } from '../store'
import type { Task } from '@shared/types'

const WEEK = ['一', '二', '三', '四', '五', '六', '日']

export function CalendarView(): React.JSX.Element {
  const { tasks, selectTask, toggleTask, openQuickAdd } = useStore()
  const [cursor, setCursor] = useState(new Date())

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const t of tasks) {
      const key = t.scheduledDate ?? (t.dueAt ? format(new Date(t.dueAt), 'yyyy-MM-dd') : null)
      if (!key) continue
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(t)
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title))
    }
    return map
  }, [tasks])

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 })
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 })
    return eachDayOfInterval({ start, end })
  }, [cursor])

  return (
    <section className="main calendar-main">
      <header className="main-head">
        <div className="main-title">
          <h1>{format(cursor, 'yyyy年M月')}</h1>
          <span className="main-count">共 {tasks.length} 项待办</span>
        </div>
        <div className="cal-nav">
          <button className="icon-btn" onClick={() => setCursor(addMonths(cursor, -1))}>
            <ChevronLeft size={16} />
          </button>
          <button className="ghost-btn" onClick={() => setCursor(new Date())}>
            今天
          </button>
          <button className="icon-btn" onClick={() => setCursor(addMonths(cursor, 1))}>
            <ChevronRight size={16} />
          </button>
          <button className="ghost-btn" onClick={openQuickAdd}>
            添加任务
          </button>
        </div>
      </header>

      <div className="cal-week">
        {WEEK.map((w) => (
          <div key={w} className="cal-weekday">
            {w}
          </div>
        ))}
      </div>

      <div className="cal-grid">
        {days.map((d) => {
          const key = format(d, 'yyyy-MM-dd')
          const items = byDay.get(key) ?? []
          return (
            <div
              key={key}
              className={`cal-cell ${isSameMonth(d, cursor) ? '' : 'dim'} ${
                isToday(d) ? 'today' : ''
              }`}
            >
              <div className="cal-date">{d.getDate()}</div>
              <div className="cal-items">
                {items.slice(0, items.length > 3 ? 2 : 3).map((t) => (
                  <button
                    key={t.id}
                    className={`cal-item ${t.status === 1 ? 'done' : ''}`}
                    data-p={t.priority}
                    onClick={() => selectTask(t.id)}
                    onDoubleClick={() => toggleTask(t.id)}
                    title={t.title}
                  >
                    {t.title}
                  </button>
                ))}
                {items.length > 3 && <div className="cal-more">还有 {items.length - 2} 项</div>}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
