import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Check, Plus, SquareArrowOutUpRight } from 'lucide-react'
import { ISLAND_ACCENTS, type IslandState } from '../../../shared/island'
import type { Task } from '../../../shared/types'
import './island.css'

type Phase = 'rest' | 'peek' | 'panel'

const CHEERS = [
  '今天全部搞定，收工！',
  '漂亮，今天清空了',
  '一件不剩，去休息吧',
  '今天的你，值得加杯奶茶',
  '清单归零，心情也归零'
]

function Ring({ done, total, size = 16 }: { done: number; total: number; size?: number }): React.JSX.Element {
  const stroke = 2.5
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const ratio = total > 0 ? Math.min(1, done / total) : 0
  return <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
    <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeOpacity=".18" strokeWidth={stroke}/>
    <circle
      cx={size / 2} cy={size / 2} r={radius} fill="none"
      stroke="currentColor" strokeWidth={stroke} strokeLinecap="round"
      strokeDasharray={circumference}
      strokeDashoffset={circumference * (1 - ratio)}
      transform={`rotate(-90 ${size / 2} ${size / 2})`}
      style={{ transition: 'stroke-dashoffset 260ms cubic-bezier(.22,1,.36,1)' }}
    />
  </svg>
}

function isOverdue(task: Task): boolean {
  const today = new Date().toLocaleDateString('sv-SE')
  if (task.scheduledDate && task.scheduledDate < today) return true
  return !!task.dueAt && new Date(task.dueAt).getTime() < Date.now()
}

function minutesLeft(task: Task): number | null {
  if (!task.dueAt) return null
  return Math.round((new Date(task.dueAt).getTime() - Date.now()) / 60_000)
}

function timeLabel(task: Task): string {
  if (task.dueAt) {
    const date = new Date(task.dueAt)
    if (!Number.isNaN(date.getTime())) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  if (task.scheduledDate) {
    const today = new Date().toLocaleDateString('sv-SE')
    return task.scheduledDate === today ? '今天' : task.scheduledDate.slice(5)
  }
  return ''
}

/** 任务行的时间颜色分三档：逾期红 / 一小时内橙 / 正常灰 */
function urgency(task: Task): 'overdue' | 'soon' | 'normal' {
  if (isOverdue(task)) return 'overdue'
  const left = minutesLeft(task)
  if (left !== null && left >= 0 && left <= 60) return 'soon'
  return 'normal'
}

function Island(): React.JSX.Element | null {
  const [state, setState] = useState<IslandState | null>(null)
  const [phase, setPhase] = useState<Phase>('rest')
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const phaseRef = useRef<Phase>('rest')
  const inputRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<{ x: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)

  useEffect(() => { phaseRef.current = phase }, [phase])

  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        setAdding(true)
        setPhase('panel')
        window.islandApi.phase('panel')
      }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])

  useEffect(() => {
    window.islandApi.state().then(setState).catch(() => {})
    const off = window.islandApi.onChanged(setState)
    const offPhase = window.islandApi.onPhaseSet(next => {
      if (next === 'rest') { setAdding(false); setDraft('') }
      setPhase(next)
    })
    return () => { off(); offPhase() }
  }, [])

  // 只有输入框出现时才让窗口接收键盘，平时保持“永不抢焦点”
  useEffect(() => {
    if (!adding) return
    window.islandApi.focusable(true)
    const first = setTimeout(() => inputRef.current?.focus(), 120)
    const retry = setTimeout(() => { if (document.activeElement !== inputRef.current) inputRef.current?.focus() }, 400)
    return () => { clearTimeout(first); clearTimeout(retry); window.islandApi.focusable(false) }
  }, [adding])

  const complete = async (id: string): Promise<void> => {
    if (busy) return
    setBusy(id)
    try { await window.islandApi.complete(id) } finally { setBusy(null) }
  }

  const save = async (): Promise<void> => {
    const text = draft.trim()
    if (!text) { setAdding(false); return }
    await window.islandApi.quickAdd(text)
    setDraft('')
    setAdding(false)
    window.islandApi.phase('panel')
  }

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    void save()
  }

  const tasks = state?.tasks ?? []
  const pending = useMemo(() => tasks.filter(t => t.status !== 1), [tasks])
  const finished = useMemo(() => tasks.filter(t => t.status === 1), [tasks])
  const stats = state?.stats
  const next = state?.next
  const allDone = !!stats && stats.total > 0 && stats.remaining === 0
  const cheer = useMemo(() => CHEERS[(stats?.done ?? 0) % CHEERS.length], [stats?.done])
  const accent = ISLAND_ACCENTS[state?.settings.accent ?? 'purple']

  if (!state) return null
  if (stats && stats.total === 0) return null

  return <div className="stage" data-theme={state.theme}>
    <section
      className={`capsule phase-${phase} ${allDone ? 'is-done' : ''}`}
      style={{ ['--accent' as string]: accent } as React.CSSProperties}
      data-island-surface
      onClick={event => {
        if (suppressClick.current) { suppressClick.current = false; return }
        if ((event.target as Element).closest('button, .capsule-body')) return
        const nextPhase: Phase = phaseRef.current === 'panel' ? 'rest' : 'panel'
        setPhase(nextPhase)
        window.islandApi.phase(nextPhase)
      }}
      onContextMenu={event => { event.preventDefault(); window.islandApi.menu() }}
      role="region"
      aria-label="任务岛"
    >
      <header
        className="capsule-head"
        onPointerDown={event => {
          if ((event.target as Element).closest('button')) return
          dragRef.current = { x: event.screenX, moved: false }
          event.currentTarget.setPointerCapture(event.pointerId)
          window.islandApi.drag('start', event.screenX)
        }}
        onPointerMove={event => {
          const active = dragRef.current
          if (!active) return
          if (!active.moved && Math.abs(event.screenX - active.x) > 3) active.moved = true
          if (active.moved) window.islandApi.drag('move', event.screenX)
        }}
        onPointerUp={event => {
          if (!dragRef.current) return
          const moved = dragRef.current.moved
          dragRef.current = null
          window.islandApi.drag('end', event.screenX)
          if (moved) suppressClick.current = true
        }}
        onPointerCancel={() => {
          if (!dragRef.current) return
          dragRef.current = null
          window.islandApi.drag('end', 0)
        }}
      >
        <span className={`ring-wrap ${allDone ? 'ok' : stats && stats.overdue > 0 ? 'late' : stats && stats.soon > 0 ? 'soon' : ''}`}>
          <Ring done={stats?.done ?? 0} total={stats?.total ?? 0} size={phase === 'rest' ? 14 : 18}/>
        </span>
        <span className="count">
          {stats?.done ?? 0}<i>/</i>{stats?.total ?? 0}
        </span>
        {phase !== 'rest' && <span className="label">
          {allDone ? <b className="cheer">今天全部完成</b>
            : next ? <>接下来：<b>{next.title}</b>{next.at && <em> · {next.at}</em>}</> : null}
        </span>}
        {phase === 'peek' && next && !allDone && <button
          className="peek-check"
          aria-label={`完成：${next.title}`}
          disabled={busy !== null}
          onClick={event => { event.stopPropagation(); void complete(next.id) }}
        ><Check size={13}/></button>}
        {phase === 'panel' && <>
          <button className="icon-btn" aria-label="快速添加" title="快速添加"
            onClick={event => { event.stopPropagation(); setAdding(true); setPhase('panel'); window.islandApi.phase('panel') }}>
            <Plus size={14}/>
          </button>
          <button className="head-link" onClick={event => { event.stopPropagation(); window.islandApi.open() }}>
            <SquareArrowOutUpRight size={12}/><span>打开轻单</span>
          </button>
        </>}
      </header>

      {phase === 'panel' && <div className="capsule-body" onClick={event => event.stopPropagation()}>
        {adding && <form className="quick-add" onSubmit={submit}>
          <input
            ref={inputRef}
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape') { setAdding(false); setDraft('') }
              if (event.key === 'Enter') { event.preventDefault(); void save() }
            }}
            placeholder="加一件事，回车保存（支持「明天下午3点 写周报」）"
            aria-label="快速添加任务"
          />
          <button type="submit" className="submit" disabled={!draft.trim()}>添加</button>
        </form>}
        <div className="task-scroll">
          {pending.length === 0 && <p className="empty">{allDone ? cheer : '今天没有待办'}</p>}
          {pending.map(task => {
            const level = urgency(task)
            return <div className={`row level-${level}`} key={task.id}>
              <button
                className="check" aria-label={`完成：${task.title}`} disabled={busy !== null}
                onClick={event => { event.stopPropagation(); void complete(task.id) }}
              ><Check size={11}/></button>
              <button className="title" title={task.title} onClick={event => { event.stopPropagation(); window.islandApi.open(task.id) }}>
                {task.title}
              </button>
              {timeLabel(task) && <span className="time">{timeLabel(task)}</span>}
            </div>
          })}
          {finished.length > 0 && <div className="done-label">已完成 {finished.length}</div>}
          {finished.slice(0, 20).map(task => <div className="row finished" key={task.id}>
            <span className="check done"><Check size={10}/></span>
            <span className="title">{task.title}</span>
          </div>)}
        </div>
        <footer className="hint">移开或再点胶囊即收起 · 右键菜单</footer>
      </div>}
    </section>
  </div>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><Island/></React.StrictMode>)
