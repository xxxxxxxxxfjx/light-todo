import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Check, Plus, SquareArrowOutUpRight, Pencil, Trash2, X } from 'lucide-react'
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const phaseRef = useRef<Phase>('rest')
  const inputRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<{ x: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)

  useEffect(() => { phaseRef.current = phase }, [phase])

  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        setEditingId(null)
        setDraft('')
        setAdding(true)
        setPhase('panel')
        window.islandApi.phase('panel')
      }
      if (event.key === 'Escape') {
        if (savingRef.current) return
        setAdding(false)
        setDraft('')
        setEditingId(null)
        setPhase('rest')
        window.islandApi.phase('rest')
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
    try { setError(''); await window.islandApi.complete(id) }
    catch (e) { setError(String(e)) } finally { setBusy(null) }
  }

  const remove = async (id: string): Promise<void> => {
    if (busy) return
    setBusy(id)
    try { setError(''); await window.islandApi.delete(id) }
    catch (e) { setError(String(e)) } finally { setBusy(null) }
  }

  const save = async (): Promise<void> => {
    const text = draft.trim()
    if (!text || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError('')
    try {
      if (editingId) await window.islandApi.update(editingId, text)
      else await window.islandApi.quickAdd(text)
      setDraft('')
      setAdding(false)
      setEditingId(null)
      window.islandApi.phase('panel')
    } catch (e) { setError(String(e)) }
    finally { savingRef.current = false; setSaving(false) }
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

  return <div className="stage" data-theme={state.theme}>
    <section
      className={`capsule phase-${phase} ${allDone ? 'is-done' : ''}`}
      style={{ ['--accent' as string]: accent } as React.CSSProperties}
      data-island-surface
      onClick={event => {
        if (suppressClick.current) { suppressClick.current = false; return }
        if ((event.target as Element).closest('button, .capsule-body') || adding) return
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
          if ((event.target as Element).closest('button') || adding) return
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
        <span className="label">
          {allDone ? <b className="cheer">今天全部完成</b>
            : next ? <>接下来：<b>{next.title}</b>{next.at && <em> · {next.at}</em>}</> : null}
        </span>
        {phase === 'peek' && next && !allDone && <button
          className="peek-check"
          aria-label={`完成：${next.title}`}
          disabled={busy !== null}
          onClick={event => { event.stopPropagation(); void complete(next.id) }}
        ><Check size={13}/></button>}
        {phase === 'panel' && <>
          <button className="icon-btn" aria-label="快速添加" title="新增今天的任务（Ctrl+N）"
            onClick={event => { event.stopPropagation(); setEditingId(null); setDraft(''); setAdding(true); setPhase('panel'); window.islandApi.phase('panel') }}>
            <Plus size={14}/>
          </button>
          <button className="icon-btn quit-btn" aria-label="退出轻单" title="完全退出轻单（包括托盘和任务岛）" onClick={() => window.islandApi.quit()}><X size={14}/></button>
          <button className="head-link" onClick={event => { event.stopPropagation(); window.islandApi.open() }}>
            <SquareArrowOutUpRight size={12}/><span>打开轻单</span>
          </button>
        </>}
      </header>

      <div className="capsule-body" inert={phase !== 'panel'} aria-hidden={phase !== 'panel'} onClick={event => event.stopPropagation()}>
        {adding && <form className="quick-add" onSubmit={submit}>
          <input
            ref={inputRef}
            value={draft}
            disabled={saving}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              if (event.key === 'Escape') { event.stopPropagation(); if (!saving) { setAdding(false); setDraft(''); setEditingId(null) } }
              if (event.key === 'Enter') { event.preventDefault(); void save() }
            }}
            placeholder={editingId ? '修改任务标题，回车保存' : '新增今天的任务，如「下午3点 写周报」'}
            aria-label={editingId ? '修改任务标题' : '快速添加任务'}
          />
          <button type="submit" className="submit" disabled={!draft.trim() || saving}>{saving ? '保存中' : editingId ? '保存' : '添加'}</button>
        </form>}
        {error && <p className="island-error" role="alert">{error}</p>}
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
              <button className="row-action" aria-label={`编辑：${task.title}`} disabled={busy !== null || saving} onClick={() => { setEditingId(task.id); setDraft(task.title); setAdding(true) }}><Pencil size={12}/></button>
              <button className="row-action" aria-label={`删除：${task.title}`} title="移入回收站" disabled={busy !== null || saving} onClick={() => void remove(task.id)}><Trash2 size={12}/></button>
            </div>
          })}
          {finished.length > 0 && <div className="done-label">已完成 {finished.length}</div>}
          {finished.map(task => <div className="row finished" key={task.id}>
            <button className="check done" aria-label={`取消完成：${task.title}`} disabled={busy !== null} onClick={() => void complete(task.id)}><Check size={10}/></button>
            <span className="title">{task.title}</span>
            <button className="row-action" aria-label={`编辑：${task.title}`} disabled={busy !== null || saving} onClick={() => { setEditingId(task.id); setDraft(task.title); setAdding(true) }}><Pencil size={12}/></button>
            <button className="row-action" aria-label={`删除：${task.title}`} title="移入回收站" disabled={busy !== null || saving} onClick={() => void remove(task.id)}><Trash2 size={12}/></button>
          </div>)}
        </div>
        <footer className="hint">Ctrl+N 新增今天 · Esc 收起 · 拖动顶部 · 删除可从回收站恢复</footer>
      </div>
    </section>
  </div>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><Island/></React.StrictMode>)
