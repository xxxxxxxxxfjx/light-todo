import { useEffect, useMemo, useRef } from 'react'
import { format, isToday } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import type { Task } from '@shared/types'
import { layoutWeekSchedule } from '../lib/week-layout'

interface Props {
  days: Date[]
  date: string
  byDay: Map<string, Task[]>
  choose: (date: string) => void
  select: (id: string) => void
  add: (text: string, date: string) => void
  move: (id: string, date: string) => Promise<unknown>
  colorOf: (task: Task) => string
  selectedId?: string | null
}

const MAX_ALL_DAY = 3

export function WeekView({ days, date, byDay, choose, select, add, move, colorOf, selectedId }: Props): React.JSX.Element {
  const scroll = useRef<HTMLDivElement>(null)
  const schedule = useMemo(() => layoutWeekSchedule(days.map(day => (byDay.get(format(day, 'yyyy-MM-dd')) ?? []).filter(t => t.dueAt && !t.dueAllDay))), [days, byDay])
  useEffect(() => {
    // Open around the beginning of the working day; all 24 hours remain reachable.
    if (scroll.current) scroll.current.scrollTop = schedule.hours[7].top
  }, [])
  const taskButton = (task: Task): React.JSX.Element => {
    const color = colorOf(task)
    return <button
      key={task.id} className={`week-task ${task.status === 1 ? 'done' : ''} ${selectedId === task.id ? 'active' : ''}`} data-p={task.priority}
      style={{ '--task-color': color } as React.CSSProperties}
      draggable onDragStart={e => e.dataTransfer.setData('text/lighttodo-task', task.id)}
      onClick={e => { e.stopPropagation(); select(task.id) }}
      onDoubleClick={e => e.stopPropagation()} title={task.title}>
      <i className="week-dot" style={{background: color}}/>
      <span>{task.title}</span>
    </button>
  }
  return <div className="week-scroll" ref={scroll} tabIndex={0} aria-label="每周时间表">
    <div className="week-sheet">
      <div className="week-header">
        <div className="week-gutter">时间</div>
        {days.map(day => {
          const key = format(day, 'yyyy-MM-dd')
          return <button key={key} className={`week-day-header ${key === date ? 'selected' : ''} ${isToday(day) ? 'today' : ''}`}
            aria-pressed={key === date} onClick={() => choose(key)} onDoubleClick={() => add('', key)}>
            <span>{format(day, 'EEE', { locale: zhCN })}</span><strong>{format(day, 'd')}</strong>
          </button>
        })}
      </div>
      <div className="week-all-day">
        <div className="week-gutter">全天</div>
        {days.map(day => {
          const key = format(day, 'yyyy-MM-dd')
          const allDay = (byDay.get(key) ?? []).filter(t => !t.dueAt || t.dueAllDay)
          const visible = allDay.slice(0, MAX_ALL_DAY)
          return <div key={key} className={`week-all-day-cell ${key === date ? 'selected' : ''}`} data-date={key} onClick={() => choose(key)} onDoubleClick={() => add('', key)} onDragOver={e => e.preventDefault()} onDrop={e => {
            e.preventDefault()
            const id = e.dataTransfer.getData('text/lighttodo-task')
            if (id) move(id, key)
          }}>
            {visible.map(t => taskButton(t))}
            {allDay.length > visible.length && <span className="week-more" title="点击日期在下方查看全部">还有 {allDay.length - visible.length} 项…</span>}
          </div>
        })}
      </div>
      <div className="week-timeline" style={{ height: schedule.height }}>
        <div className="week-hours">{schedule.hours.map((slot, hour) => <span key={hour} style={{ top: slot.top }}>{String(hour).padStart(2, '0')}:00</span>)}</div>
        {days.map((day, dayIndex) => {
          const key = format(day, 'yyyy-MM-dd')
          const timed = schedule.days[dayIndex]
          return <div key={key} data-date={key} className={`week-column ${key === date ? 'selected' : ''}`}
            onClick={() => choose(key)} onDoubleClick={e => {
              if (e.target !== e.currentTarget) return
              const y = e.clientY - e.currentTarget.getBoundingClientRect().top
              const hour = Math.max(0, schedule.hours.findLastIndex(slot => slot.top <= y))
              add(`${hour}:00 `, key)
            }} onDragOver={e => e.preventDefault()} onDrop={e => {
              e.preventDefault()
              const id = e.dataTransfer.getData('text/lighttodo-task')
              if (id) move(id, key)
            }}>
            {schedule.hours.map((slot, hour) => <div key={hour} className="week-hour-line" style={{ top: slot.top }} aria-hidden="true"/>)}
            {timed.map(({ start, top, height, tasks }) => <div key={start} className="week-event" role="group"
              aria-label={`${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}，${tasks.length} 项任务`}
              style={{ top, height }} onDoubleClick={e => e.stopPropagation()}>
              <div className="week-event-heading"><time className="week-event-time">{String(Math.floor(start / 60)).padStart(2, '0')}:{String(start % 60).padStart(2, '0')}</time>{tasks.length > 1 && <span className="week-event-count">{tasks.length} 项</span>}</div>
              <div className="week-event-stack">{tasks.map((task) => taskButton(task))}</div>
            </div>)}
          </div>
        })}
      </div>
    </div>
  </div>
}
