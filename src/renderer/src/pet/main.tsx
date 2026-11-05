import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Check, Ellipsis } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { PET_SIZE, type PetState } from '../../../shared/pet'
import { Mascot } from './Mascot'
import './pet.css'

function Pet(): React.JSX.Element {
  const [state, setState] = useState<PetState | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [happy, setHappy] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const tasks = state?.tasks ?? []
  const virtualTasks = useVirtualizer({ count: tasks.length, getScrollElement: () => list.current, estimateSize: () => 26, overscan: 3, getItemKey: index => tasks[index].id })
  useEffect(() => { window.petApi.expanded(expanded) }, [expanded])
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const celebration = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const show = (): void => {
    clearTimeout(hideTimer.current)
    if (!drag.current) setExpanded(true)
  }
  const hide = (): void => {
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setExpanded(false), 220)
  }
  useEffect(() => {
    const off = window.petApi.onChanged(setState)
    window.petApi.state().then(setState).catch(() => setError('加载失败，请重新开启'))
    let interactive = false
    const move = (e: PointerEvent): void => {
      const hit = !!(e.target as Element).closest('[data-pet-surface]') || !!drag.current
      if (hit !== interactive) { interactive = hit; window.petApi.interactive(hit) }
    }
    const leave = (): void => {
      if (drag.current) return
      interactive = false
      window.petApi.interactive(false)
      hide()
    }
    document.addEventListener('pointermove', move)
    document.documentElement.addEventListener('pointerleave', leave)
    return () => {
      off(); clearTimeout(celebration.current); clearTimeout(hideTimer.current)
      document.removeEventListener('pointermove', move)
      document.documentElement.removeEventListener('pointerleave', leave)
    }
  }, [])
  const complete = async (id: string): Promise<void> => {
    if (busy) return
    setBusy(id)
    try {
      await window.petApi.complete(id)
      setHappy(true)
      setError('')
      clearTimeout(celebration.current)
      celebration.current = setTimeout(() => setHappy(false), 1600)
    } catch { setError('这次没成功，再试一下吧') }
    finally { setBusy(null) }
  }
  const finishDrag = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (!drag.current) return
    const moved = drag.current.moved
    drag.current = null
    window.petApi.drag('end')
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!moved) show()
  }
  const today = new Date().toLocaleDateString('sv-SE')
  return <main style={{ width: PET_SIZE.width, height: PET_SIZE.height, transform: `scale(${state?.displayScale ?? 1})` }} className={`pet-shell ${state?.settings.skin === 'bunny' ? 'bunny' : ''}`} onContextMenu={e => { e.preventDefault(); window.petApi.menu() }}>
    <div className="pet-hover-area" onPointerEnter={show} onPointerLeave={hide}>
      {expanded && <section className="pet-card" data-pet-surface aria-label="桌面今日任务">
        <header className="pet-heading"><span>待办 <em>{tasks.length}</em></span><button aria-label="桌宠菜单" onClick={() => window.petApi.menu()}><Ellipsis size={14}/></button></header>
        <div className="pet-tasks" ref={list} tabIndex={0} aria-label="今日任务列表，可滚轮滚动">
          {!state && !error && <div className="pet-empty">加载中…</div>}
          {state && tasks.length === 0 && <div className="pet-empty">今天都完成啦 ♡</div>}
          <div style={{ height: virtualTasks.getTotalSize(), position: 'relative' }}>{virtualTasks.getVirtualItems().map(row => {
            const task = tasks[row.index]
            const overdue = !!((task.scheduledDate && task.scheduledDate < today) || (task.dueAt && new Date(task.dueAt).getTime() < Date.now()))
            return <div className="pet-task" key={task.id} style={{ position: 'absolute', top: row.start, left: 0, width: '100%' }}>
              <button className="pet-check" disabled={busy !== null} aria-label={`完成：${task.title}`} onClick={() => complete(task.id)}><Check size={11}/></button>
              <button className="pet-task-title" title={task.title} onClick={() => window.petApi.open(task.id)}>{task.title}</button>
              {(overdue || task.priority === 3) && <span className="pet-dot" role="img" aria-label={overdue ? '已逾期' : '高优先级'}/>}
            </div>
          })}</div>
        </div>
        {error && <p className="pet-error" role="alert">{error}</p>}
      </section>}
      <button className="pet-avatar" data-pet-surface aria-label="桌面宠物，移入查看待办，拖动调整位置" onFocus={show}
        onPointerDown={event => {
          if (event.button !== 0) return
          drag.current = { x: event.clientX, y: event.clientY, moved: false }
          event.currentTarget.setPointerCapture(event.pointerId)
          window.petApi.drag('start', event.screenX, event.screenY)
          clearTimeout(hideTimer.current)
        }}
        onPointerMove={event => {
          const active = drag.current
          if (!active) return
          if (!active.moved && Math.hypot(event.clientX - active.x, event.clientY - active.y) > 4) { active.moved = true; setExpanded(false) }
          if (active.moved) window.petApi.drag('move', event.screenX, event.screenY)
        }} onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}>
        <Mascot skin={state?.settings.skin} happy={happy}/>
      </button>
    </div>
  </main>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Pet/></React.StrictMode>)
