import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PET_SIZE, type PetState } from '../../../shared/pet'
import { Mascot, type PetMood } from './Mascot'
import './pet.css'

const IDLE_SLEEP_MS = 90_000
const MOOD_RESET_MS = 1_600

/**
 * 桌宠只做一件事：一只会呼吸、会看你、被点会跳的猫。
 * 任务列表交给灵动岛，宠物不再承载功能。
 */
function Pet(): React.JSX.Element {
  const [state, setState] = useState<PetState | null>(null)
  const [mood, setMood] = useState<PetMood>('idle')
  const [look, setLook] = useState({ x: 0, y: 0 })
  const [hearts, setHearts] = useState<number[]>([])
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const moodTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const sleepTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const heartSeq = useRef(0)

  const wake = useCallback((): void => {
    setMood(current => (current === 'sleep' ? 'curious' : current))
    clearTimeout(sleepTimer.current)
    sleepTimer.current = setTimeout(() => setMood('sleep'), IDLE_SLEEP_MS)
  }, [])

  useEffect(() => {
    window.petApi.state().then(setState).catch(() => { /* 主进程尚未就绪 */ })
    const off = window.petApi.onChanged(setState)
    // 整窗默认穿透，只有指针落在猫身上时才接管鼠标。
    let interactive = false
    const move = (event: PointerEvent): void => {
      const hit = !!(event.target as Element).closest('[data-pet-surface]') || !!drag.current
      if (hit !== interactive) { interactive = hit; window.petApi.interactive(hit) }
    }
    const leave = (): void => {
      if (drag.current) return
      interactive = false
      window.petApi.interactive(false)
    }
    document.addEventListener('pointermove', move)
    document.documentElement.addEventListener('pointerleave', leave)
    wake()
    return () => {
      off()
      document.removeEventListener('pointermove', move)
      document.documentElement.removeEventListener('pointerleave', leave)
      clearTimeout(moodTimer.current)
      clearTimeout(sleepTimer.current)
    }
  }, [wake])

  const celebrate = (): void => {
    setMood('happy')
    clearTimeout(moodTimer.current)
    moodTimer.current = setTimeout(() => setMood('idle'), MOOD_RESET_MS)
    const id = ++heartSeq.current
    setHearts(list => [...list, id])
    setTimeout(() => setHearts(list => list.filter(item => item !== id)), 1000)
  }

  const follow = (event: React.PointerEvent<HTMLElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width === 0) return
    setLook({
      x: Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1)),
      y: Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1))
    })
  }

  return <main
    className={`pet-shell ${dragging ? 'is-dragging' : ''}`}
    style={{
      width: PET_SIZE.width,
      height: PET_SIZE.height,
      opacity: state?.settings.opacity ?? 1,
      transform: `scale(${state?.displayScale ?? 1})`,
      ['--look-x' as string]: look.x
    } as React.CSSProperties}
    onPointerMove={event => { follow(event); wake() }}
    onPointerLeave={() => setLook({ x: 0, y: 0 })}
    onContextMenu={event => { event.preventDefault(); window.petApi.menu() }}
  >
    <button
      className="pet-avatar"
      data-pet-surface
      aria-label="桌面宠物：单击逗它一下，拖动换位置，双击打开轻单，右键菜单"
      onPointerDown={event => {
        if (event.button !== 0) return
        drag.current = { x: event.clientX, y: event.clientY, moved: false }
        event.currentTarget.setPointerCapture(event.pointerId)
        window.petApi.drag('start', event.screenX, event.screenY)
        clearTimeout(moodTimer.current)
      }}
      onPointerMove={event => {
        const active = drag.current
        if (!active) return
        if (!active.moved && Math.hypot(event.clientX - active.x, event.clientY - active.y) > 4) {
          active.moved = true
          setDragging(true)
        }
        if (active.moved) window.petApi.drag('move', event.screenX, event.screenY)
      }}
      onPointerUp={event => {
        const active = drag.current
        if (!active) return
        drag.current = null
        setDragging(false)
        window.petApi.drag('end')
        window.petApi.interactive(true)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        if (!active.moved) celebrate()
      }}
      onPointerCancel={() => {
        if (!drag.current) return
        drag.current = null
        setDragging(false)
        window.petApi.drag('end')
      }}
      onDoubleClick={() => window.petApi.open()}
      onFocus={() => setMood('curious')}
      onBlur={() => setMood('idle')}
    >
      <Mascot skin={state?.settings.skin} mood={mood}/>
    </button>
    {hearts.map(id => <span key={id} className="pet-heart" aria-hidden="true">❤</span>)}
  </main>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><Pet/></React.StrictMode>)
