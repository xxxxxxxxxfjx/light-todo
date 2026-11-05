import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { addDays, addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, getDaysInMonth, isSameMonth, isToday, startOfMonth, startOfWeek } from 'date-fns'
import { Check, ChevronLeft, ChevronRight, ChevronsUpDown, Plus } from 'lucide-react'
import { zhCN } from 'date-fns/locale'
import { useStore } from '../store'
import { parseLocalDate } from '../lib/format'
import type { Task } from '@shared/types'
import { WeekView } from './WeekView'

const WEEK = ['一', '二', '三', '四', '五', '六', '日']
type Mode = 'month' | 'week' | 'day'

const DEFAULT_AGENDA_HEIGHT = 230
const MIN_AGENDA_HEIGHT = 132
const MIN_CALENDAR_HEIGHT = 200
const AGENDA_STORAGE_KEY = 'lighttodo.calendarAgendaHeight'
const MONTH_ITEM_HEIGHT = 15
const MONTH_DATE_HEIGHT = 20
const MONTH_MORE_HEIGHT = 12
const MONTH_ROW_HEIGHT = 74
const MONTH_FEED_RADIUS = 1

function monthsAround(dateKey: string): string[] {
  const base = startOfMonth(parseLocalDate(dateKey))
  return Array.from({ length: MONTH_FEED_RADIUS * 2 + 1 }, (_, i) =>
    format(addMonths(base, i - MONTH_FEED_RADIUS), 'yyyy-MM')
  )
}

function maxAgendaHeight(main: HTMLElement | null): number {
  const height = main?.clientHeight ?? 700
  return Math.max(MIN_AGENDA_HEIGHT, height - MIN_CALENDAR_HEIGHT - 150)
}

function readPreferredHeight(): number {
  const saved = Number(localStorage.getItem(AGENDA_STORAGE_KEY))
  return Number.isFinite(saved) && saved >= MIN_AGENDA_HEIGHT ? Math.round(saved) : DEFAULT_AGENDA_HEIGHT
}

function clampAgendaHeight(value: number, max: number): number {
  return Math.round(Math.min(Math.max(value, MIN_AGENDA_HEIGHT), Math.max(MIN_AGENDA_HEIGHT, max)))
}

export function CalendarView(): React.JSX.Element {
  const { tasks, selected, selectTask, toggleTask, openQuickAdd, updateTask, sidebar, loading, error, refresh, setCalendarRange } = useStore()
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [mode, setMode] = useState<Mode>(() => { const saved=localStorage.getItem('lighttodo.calendarMode'); return saved === 'week' || saved === 'day' ? saved : 'month' })
  const changeMode = (next: Mode): void => { setMode(next); localStorage.setItem('lighttodo.calendarMode', next) }
  const [showDone, setShowDone] = useState(false)
  const [monthKeys, setMonthKeys] = useState<string[]>(() => monthsAround(date))
  const [visibleMonthKey, setVisibleMonthKey] = useState(() => format(parseLocalDate(date), 'yyyy-MM'))
  const preferredHeight = useRef(0)
  if (preferredHeight.current === 0) preferredHeight.current = readPreferredHeight()
  const [agendaHeight, setAgendaHeight] = useState<number>(() => clampAgendaHeight(preferredHeight.current, maxAgendaHeight(null)))
  const [maxHeight, setMaxHeight] = useState<number>(() => maxAgendaHeight(null))
  const [resizing, setResizing] = useState(false)
  const mainRef = useRef<HTMLElement>(null)
  const monthScroll = useRef<HTMLDivElement>(null)
  const agendaList = useRef<HTMLDivElement>(null)
  const stopResize = useRef<(() => void) | null>(null)
  const pendingMonthScroll = useRef<{ type: 'prepend'; oldHeight: number } | { type: 'target'; monthKey: string } | null>(null)
  const monthScrollLock = useRef(false)
  const monthScrollFrame = useRef(0)
  const cursor = parseLocalDate(date)
  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const t of tasks) {
      if (!showDone && t.status === 1) continue
      const key = t.scheduledDate ?? (t.dueAt ? format(new Date(t.dueAt), 'yyyy-MM-dd') : null)
      if (!key) continue
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(t)
    }
    for (const list of map.values()) list.sort((a,b) => a.status-b.status || (a.dueAt ?? 'z').localeCompare(b.dueAt ?? 'z') || b.priority-a.priority)
    return map
  }, [tasks, showDone])
  const days = useMemo(() => mode === 'day' ? [parseLocalDate(date)] : mode === 'week' ? eachDayOfInterval({
    start: startOfWeek(cursor, { weekStartsOn: 1 }),
    end: endOfWeek(cursor, { weekStartsOn: 1 })
  }) : [], [date, mode])

  useEffect(() => {
    if (mode === 'month') {
      const first = parseLocalDate(`${monthKeys[0]}-01`)
      const last = parseLocalDate(`${monthKeys[monthKeys.length - 1]}-01`)
      void setCalendarRange(format(startOfWeek(first, { weekStartsOn: 1 }), 'yyyy-MM-dd'), format(endOfWeek(endOfMonth(last), { weekStartsOn: 1 }), 'yyyy-MM-dd'))
    } else void setCalendarRange(format(days[0], 'yyyy-MM-dd'), format(days[days.length - 1], 'yyyy-MM-dd'))
  }, [mode, monthKeys, days, setCalendarRange])

  const scrollMonthIntoView = (monthKey: string): void => {
    const el = monthScroll.current
    if (!el) return
    const block = el.querySelector<HTMLElement>(`[data-month-block="${monthKey}"]`)
    if (!block) return
    monthScrollLock.current = true
    el.scrollTop = block.offsetTop
    setVisibleMonthKey(monthKey)
    requestAnimationFrame(() => requestAnimationFrame(() => { monthScrollLock.current = false }))
  }

  const ensureMonthVisible = (monthKey: string): void => {
    if (monthKeys.includes(monthKey)) {
      setVisibleMonthKey(monthKey)
      requestAnimationFrame(() => scrollMonthIntoView(monthKey))
      return
    }
    const keys = monthsAround(`${monthKey}-01`)
    setVisibleMonthKey(monthKey)
    setMonthKeys(keys)
    pendingMonthScroll.current = { type: 'target', monthKey }
  }

  const choose = (key: string): void => {
    setDate(key)
    selectTask(null)
  }

  const jumpToDate = (key: string): void => {
    choose(key)
    if (mode === 'month') ensureMonthVisible(key.slice(0, 7))
  }

  const navigate = (n: number): void => {
    if (mode === 'month') {
      const base = parseLocalDate(`${visibleMonthKey}-01`)
      const target = addMonths(base, n)
      const day = Math.min(cursor.getDate(), getDaysInMonth(target))
      jumpToDate(format(addDays(startOfMonth(target), day - 1), 'yyyy-MM-dd'))
      return
    }
    choose(format(mode === 'week' ? addWeeks(cursor, n) : addDays(cursor, n), 'yyyy-MM-dd'))
  }
  const items = byDay.get(date) ?? []
  const rowHeight = mode === 'day' ? 46 : 38
  const virtualAgenda = useVirtualizer({
    count: items.length, getScrollElement: () => agendaList.current,
    estimateSize: () => rowHeight, overscan: 6,
    getItemKey: index => items[index].id
  })
  useEffect(() => virtualAgenda.measure(), [rowHeight])
  const pending = items.filter(t => t.status === 0).length
  const colorOf = (t: Task): string => sidebar.lists.find(l => l.id === t.listId)?.color ?? 'var(--accent)'

  // Keep the rendered height inside the current window while preserving the user's preferred height.
  useEffect(() => {
    const main = mainRef.current
    if (!main) return
    const sync = (): void => {
      const max = maxAgendaHeight(main)
      setMaxHeight(max)
      setAgendaHeight(clampAgendaHeight(preferredHeight.current, max))
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(main)
    window.addEventListener('resize', sync)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [])

  useEffect(() => {
    if (agendaList.current) agendaList.current.scrollTop = 0
  }, [date, mode])

  useEffect(() => () => {
    stopResize.current?.()
    if (monthScrollFrame.current) cancelAnimationFrame(monthScrollFrame.current)
    document.body.classList.remove('calendar-resizing')
  }, [])

  // Center the month feed on the selected month whenever month view is opened.
  useEffect(() => {
    if (mode !== 'month') return
    const monthKey = format(parseLocalDate(date), 'yyyy-MM')
    setMonthKeys(monthsAround(date))
    setVisibleMonthKey(monthKey)
    pendingMonthScroll.current = { type: 'target', monthKey }
  }, [mode])

  // Apply feed mutations after layout: keep the viewport stable when prepending months.
  useLayoutEffect(() => {
    if (mode !== 'month') return
    const action = pendingMonthScroll.current
    if (!action) return
    const el = monthScroll.current
    if (!el) return
    pendingMonthScroll.current = null
    if (action.type === 'prepend') {
      el.scrollTop += el.scrollHeight - action.oldHeight
      return
    }
    const block = el.querySelector<HTMLElement>(`[data-month-block="${action.monthKey}"]`)
    if (!block) return
    monthScrollLock.current = true
    el.scrollTop = block.offsetTop
    setVisibleMonthKey(action.monthKey)
    requestAnimationFrame(() => requestAnimationFrame(() => { monthScrollLock.current = false }))
  }, [monthKeys, mode])

  const visibleMonthItems = (total: number): number => {
    const available = MONTH_ROW_HEIGHT - MONTH_DATE_HEIGHT - 3
    let count = Math.floor((available + 1) / (MONTH_ITEM_HEIGHT + 1))
    if (total > count) count = Math.floor((available + 1 - MONTH_MORE_HEIGHT) / (MONTH_ITEM_HEIGHT + 1))
    return Math.max(0, Math.min(count, 4, total))
  }

  const prependMonth = (): void => {
    const el = monthScroll.current
    if (!el || !monthKeys.length) return
    const previous = format(addMonths(parseLocalDate(`${monthKeys[0]}-01`), -1), 'yyyy-MM')
    if (monthKeys.includes(previous)) return
    monthScrollLock.current = true
    pendingMonthScroll.current = { type: 'prepend', oldHeight: el.scrollHeight }
    setMonthKeys((keys) => keys.includes(previous) ? keys : [previous, ...keys])
    requestAnimationFrame(() => requestAnimationFrame(() => { monthScrollLock.current = false }))
  }

  const appendMonth = (): void => {
    if (!monthKeys.length) return
    const next = format(addMonths(parseLocalDate(`${monthKeys[monthKeys.length - 1]}-01`), 1), 'yyyy-MM')
    if (monthKeys.includes(next)) return
    monthScrollLock.current = true
    setMonthKeys((keys) => keys.includes(next) ? keys : [...keys, next])
    requestAnimationFrame(() => requestAnimationFrame(() => { monthScrollLock.current = false }))
  }

  const onMonthScroll = (): void => {
    const el = monthScroll.current
    if (!el || monthScrollFrame.current) return
    monthScrollFrame.current = requestAnimationFrame(() => {
      monthScrollFrame.current = 0
      const blocks = Array.from(el.querySelectorAll<HTMLElement>('[data-month-block]'))
      if (blocks.length) {
        const viewTop = el.scrollTop
        const viewBottom = viewTop + el.clientHeight
        let current = blocks[0]
        let visibleHeight = 0
        for (const block of blocks) {
          const visible = Math.max(0, Math.min(block.offsetTop + block.offsetHeight, viewBottom) - Math.max(block.offsetTop, viewTop))
          if (visible > visibleHeight) {
            current = block
            visibleHeight = visible
          }
        }
        const key = current.dataset.monthBlock
        if (key) setVisibleMonthKey((prev) => prev === key ? prev : key)
      }
      if (monthScrollLock.current) return
      if (el.scrollTop < 80) prependMonth()
      else if (el.scrollHeight - el.scrollTop - el.clientHeight < 140) appendMonth()
    })
  }

  const commitAgendaHeight = (value: number, persist: boolean): void => {
    const next = clampAgendaHeight(value, maxAgendaHeight(mainRef.current))
    preferredHeight.current = next
    setAgendaHeight(next)
    if (persist) {
      try { localStorage.setItem(AGENDA_STORAGE_KEY, String(next)) } catch { /* storage unavailable */ }
    }
  }

  const startResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const target = event.currentTarget
    const pointerId = event.pointerId
    const startY = event.clientY
    const startHeight = agendaHeight
    preferredHeight.current = startHeight
    setResizing(true)
    target.focus()
    try { target.setPointerCapture(pointerId) } catch { /* capture unsupported */ }
    document.body.classList.add('calendar-resizing')
    const onMove = (e: PointerEvent): void => {
      commitAgendaHeight(startHeight + startY - e.clientY, false)
    }
    const finish = (): void => {
      setResizing(false)
      document.body.classList.remove('calendar-resizing')
      try { target.releasePointerCapture(pointerId) } catch { /* already released */ }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      stopResize.current = null
      try { localStorage.setItem(AGENDA_STORAGE_KEY, String(preferredHeight.current)) } catch { /* storage unavailable */ }
    }
    stopResize.current = finish
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const resetAgendaHeight = (): void => {
    commitAgendaHeight(DEFAULT_AGENDA_HEIGHT, true)
  }

  const splitterKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const max = maxAgendaHeight(mainRef.current)
    if (event.key === 'ArrowUp') { event.preventDefault(); commitAgendaHeight(agendaHeight + 16, true) }
    else if (event.key === 'ArrowDown') { event.preventDefault(); commitAgendaHeight(agendaHeight - 16, true) }
    else if (event.key === 'Home') { event.preventDefault(); commitAgendaHeight(MIN_AGENDA_HEIGHT, true) }
    else if (event.key === 'End') { event.preventDefault(); commitAgendaHeight(max, true) }
  }

  const monthCell = (d: Date, monthDate: Date): React.JSX.Element => {
    const key = format(d, 'yyyy-MM-dd')
    const list = byDay.get(key) ?? []
    const visible = visibleMonthItems(list.length)
    return <div key={key} role="gridcell" aria-selected={key === date} aria-label={`${key}，${list.length}项任务`} tabIndex={key === date ? 0 : -1} data-date={key} className={`cal-cell ${isSameMonth(d,monthDate) ? '' : 'dim'} ${isToday(d) ? 'today' : ''} ${key === date ? 'selected-day' : ''}`} onClick={() => choose(key)} onDoubleClick={() => openQuickAdd('',key)} onDragOver={e => e.preventDefault()} onDrop={async e => {e.preventDefault(); const id=e.dataTransfer.getData('text/lighttodo-task'); if(id && tasks.some(t => t.id === id)) {choose(key); await updateTask(id,{scheduledDate:key})}}}>
      <div className="cal-date"><span>{d.getDate()}</span></div>
      <div className="cal-items">
        {list.slice(0, visible).map(t => <button key={t.id} draggable onDragStart={e => e.dataTransfer.setData('text/lighttodo-task',t.id)} className={`cal-item ${t.status === 1 ? 'done' : ''} ${selected?.id === t.id ? 'active' : ''}`} data-p={t.priority} style={{'--task-color': colorOf(t)} as React.CSSProperties} onClick={e => {e.stopPropagation(); setDate(key); selectTask(t.id)}} onDoubleClick={e => e.stopPropagation()} title={`${t.dueAt && !t.dueAllDay ? format(new Date(t.dueAt),'HH:mm') + ' ' : ''}${t.title}`}>
          <i className="cal-dot" style={{background: colorOf(t)}}/>
          <span className="cal-title">{t.title}</span>
          {t.dueAt && !t.dueAllDay && <time>{format(new Date(t.dueAt),'HH:mm')}</time>}
        </button>)}
      </div>
      {list.length > visible && <span className="cal-more" title="点击日期在下方查看全部">还有 {list.length - visible} 项…</span>}
    </div>
  }

  const taskRow = (t: Task): React.JSX.Element => {
    const list = sidebar.lists.find(l => l.id === t.listId)
    const color = list?.color ?? 'var(--accent)'
    const when = t.dueAt && !t.dueAllDay ? format(new Date(t.dueAt),'HH:mm') : '全天'
    const meta = [list?.name, ...t.tags.map(x => x.name)].filter(Boolean).join(' · ')
    return <div key={t.id} className={`agenda-row ${t.status === 1 ? 'done' : ''} ${selected?.id === t.id ? 'active' : ''}`}>
      <button className={`check ${t.status === 1 ? 'checked' : ''}`} aria-label={t.status === 1 ? '撤销完成' : '完成任务'} onClick={() => toggleTask(t.id)}><Check size={12}/></button>
      <button className="agenda-task" onClick={() => selectTask(t.id)} title={meta ? `${t.title} · ${meta}` : t.title}>
        <i className="agenda-dot" style={{background: color}}/>
        <span className="agenda-title">{t.title}</span>
        {list && <span className="agenda-meta">{list.name}</span>}
      </button>
      <time>{when}</time>
    </div>
  }

  const monthKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if ((event.target as HTMLElement).dataset.date === undefined) return
    const shift = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[event.key]
    if (shift) {
      event.preventDefault()
      const next = format(addDays(cursor, shift), 'yyyy-MM-dd')
      if (next.slice(0, 7) !== visibleMonthKey) jumpToDate(next)
      else choose(next)
      requestAnimationFrame(() => monthScroll.current?.querySelector<HTMLElement>(`[data-date="${next}"]`)?.focus())
    }
    if (event.key === 'Enter') { event.preventDefault(); changeMode('day') }
  }

  const headingDate = mode === 'month' ? parseLocalDate(`${visibleMonthKey}-01`) : cursor

  return <section ref={mainRef} className={`main calendar-main calendar-${mode} ${resizing ? 'is-resizing' : ''}`}>
    <header className="calendar-toolbar">
      <div className="calendar-heading"><h1>{format(headingDate, mode === 'day' ? 'yyyy年M月d日' : 'yyyy年M月')}</h1><span>{mode === 'month' ? '月历' : mode === 'week' ? `${format(days[0], 'M/d')} – ${format(days[6], 'M/d')}` : format(cursor,'EEEE',{locale:zhCN})}</span></div>
      <div className="segmented calendar-modes">{([{key:'month',label:'月视图'},{key:'week',label:'周视图'},{key:'day',label:'日视图'}] as const).map(m => <button key={m.key} className={`seg ${mode === m.key ? 'active' : ''}`} onClick={() => changeMode(m.key)}>{m.label}</button>)}</div>
      <div className="cal-nav"><button className="icon-btn" aria-label="上一页" onClick={() => navigate(-1)}><ChevronLeft size={17}/></button><button className="ghost-btn" onClick={() => jumpToDate(format(new Date(),'yyyy-MM-dd'))}>今天</button><button className="icon-btn" aria-label="下一页" onClick={() => navigate(1)}><ChevronRight size={17}/></button><input aria-label="跳转日期" type="date" value={date} onChange={e => e.target.value && jumpToDate(e.target.value)}/></div>
    </header>
    <div className="calendar-subbar"><span>{mode === 'month' ? '单击选择 · 双击新建 · 滚动切换月份 · 拖动调整计划日' : mode === 'day' ? '拖动任务调整计划日' : '单击选择 · 双击新建 · 拖动任务调整计划日'}</span><label><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)}/> 显示已完成</label></div>
    {error && <div className="list-error" role="alert">{error}<button onClick={() => refresh()}>重试</button></div>}
    {loading && tasks.length === 0 && <div className="list-loading">加载中…</div>}
    {mode === 'month' && <div className="month-scroll" ref={monthScroll} onScroll={onMonthScroll} aria-label="月历（可滚动）">
      <div className="month-feed">
        {monthKeys.map((key) => {
          const monthDate = parseLocalDate(`${key}-01`)
          const blockDays = eachDayOfInterval({
            start: startOfWeek(startOfMonth(monthDate), { weekStartsOn: 1 }),
            end: endOfWeek(endOfMonth(monthDate), { weekStartsOn: 1 })
          })
          return <section key={key} data-month-block={key} className="month-block">
            <div className="month-block-head"><h2>{format(monthDate, 'yyyy年M月')}</h2></div>
            <div className="cal-week">{WEEK.map(w => <div key={w} className="cal-weekday">周{w}</div>)}</div>
            <div className="cal-grid month-grid" role="grid" aria-label={format(monthDate, 'yyyy年M月')} style={{ gridTemplateRows: `repeat(${blockDays.length / 7}, ${MONTH_ROW_HEIGHT}px)` }} onKeyDown={monthKeyDown}>
              {blockDays.map((d) => monthCell(d, monthDate))}
            </div>
          </section>
        })}
      </div>
    </div>}
    {mode === 'week' && <WeekView days={days} date={date} byDay={byDay} choose={choose} select={id => selectTask(id)} add={openQuickAdd} move={async (id, key) => { if (tasks.some(t => t.id === id)) { choose(key); await updateTask(id, {scheduledDate:key}) } }} colorOf={colorOf} selectedId={selected?.id} />}
    {mode !== 'day' && <div className="calendar-splitter" role="separator" aria-orientation="horizontal" aria-label="调整日历和任务列表高度" aria-controls="calendar-agenda" aria-valuemin={MIN_AGENDA_HEIGHT} aria-valuemax={maxHeight} aria-valuenow={agendaHeight} aria-valuetext={`任务区高度 ${agendaHeight} 像素`} tabIndex={0} title="拖动调整任务区高度 · 双击恢复默认" onPointerDown={startResize} onDoubleClick={resetAgendaHeight} onKeyDown={splitterKey}><span><ChevronsUpDown size={13}/></span></div>}
    <section id="calendar-agenda" className="calendar-agenda" aria-label="当天任务" style={{ '--agenda-height': `${agendaHeight}px` } as React.CSSProperties}>
      <div className="agenda-head"><div><h2>{format(cursor,'M月d日 EEEE',{locale:zhCN})}{isToday(cursor) && <em>今天</em>}</h2><span>{pending} 项待办{showDone ? ` · ${items.length-pending} 项已完成` : ''}</span></div><button className="primary-btn" onClick={() => openQuickAdd('',date)}><Plus size={14}/>添加任务</button></div>
      <div className="agenda-list" ref={agendaList}>{items.length ? <div style={{ height: virtualAgenda.getTotalSize(), position: 'relative' }}>{virtualAgenda.getVirtualItems().map(row => <div key={row.key} style={{ position: 'absolute', top: row.start, left: 0, width: '100%', height: row.size }}>{taskRow(items[row.index])}</div>)}</div> : <div className="agenda-empty"><span>{loading ? '正在加载这个日期的任务…' : `这一天还没有${showDone ? '' : '待办'}任务`}</span>{!loading && <button className="ghost-btn" onClick={() => openQuickAdd('',date)}>为这一天添加安排</button>}</div>}</div>
    </section>
  </section>
}
