import { useCallback, useEffect, useState } from 'react'
import { CalendarDays, Check, Inbox, Moon, Trash2, X } from 'lucide-react'
import { format } from 'date-fns'
import type { Task } from '@shared/types'
import { useStore } from '../store'

const todayStr = (): string => format(new Date(), 'yyyy-MM-dd')

export function ReplanPanel(): React.JSX.Element | null {
  const { replanOpen, closeReplan, refresh, refreshSidebar, showToast } = useStore()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const [dateFor, setDateFor] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setTasks(await window.api.replan.list())
    } catch (error) {
      showToast(`读取逾期任务失败：${String(error)}`)
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    if (!replanOpen) return
    setActive(0)
    setDateFor(null)
    void load()
  }, [replanOpen, load])

  const finish = useCallback(async (): Promise<void> => {
    try {
      await window.api.settings.set('replan_last_shown', todayStr())
    } catch {
      /* best effort */
    }
    closeReplan()
  }, [closeReplan])

  const act = useCallback(
    async (task: Task, action: 'complete' | 'today' | 'tomorrow' | 'date' | 'someday', date?: string): Promise<void> => {
      try {
        await window.api.replan.act(task.id, action, date)
        setTasks((current) => current.filter((item) => item.id !== task.id))
        setActive((index) => Math.max(0, Math.min(index, tasks.length - 2)))
        await Promise.all([refresh(), refreshSidebar()])
      } catch (error) {
        showToast(`处理失败：${String(error)}`)
      }
    },
    [refresh, refreshSidebar, showToast, tasks.length]
  )

  const postponeAll = async (): Promise<void> => {
    for (const task of tasks) {
      try {
        await window.api.replan.act(task.id, 'today')
      } catch {
        /* keep going */
      }
    }
    setTasks([])
    await Promise.all([refresh(), refreshSidebar()])
    showToast('已全部顺延到今天')
  }

  if (!replanOpen) return null

  const current = tasks[Math.min(active, Math.max(0, tasks.length - 1))]

  return (
    <div className="overlay" onMouseDown={() => void finish()}>
      <div
        className="replan-panel"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
          if (event.key === 'Escape') void finish()
          if (!current) return
          if (event.key === 'ArrowDown' || event.key.toLowerCase() === 'j') {
            event.preventDefault()
            setActive((index) => Math.min(index + 1, tasks.length - 1))
          }
          if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'k') {
            event.preventDefault()
            setActive((index) => Math.max(index - 1, 0))
          }
          if (event.key.toLowerCase() === 'd') void act(current, 'complete')
          if (event.key.toLowerCase() === 't') void act(current, 'today')
          if (event.key.toLowerCase() === 'm') void act(current, 'tomorrow')
          if (event.key.toLowerCase() === 's') void act(current, 'someday')
        }}
        tabIndex={-1}
      >
        <div className="replan-head">
          <div>
            <h2>清理逾期</h2>
            <p>昨天及更早没完成的任务，一条条决定去向。不会自动帮你改期。</p>
          </div>
          <button className="icon-btn" aria-label="关闭" onClick={() => void finish()}>
            <X size={16} />
          </button>
        </div>

        {loading && <div className="replan-empty">正在读取…</div>}
        {!loading && tasks.length === 0 && (
          <div className="replan-empty">
            <Check size={20} />
            没有逾期任务，今天很干净。
          </div>
        )}

        <div className="replan-list">
          {tasks.map((task, index) => (
            <div
              key={task.id}
              className={`replan-row ${index === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(index)}
            >
              <div className="replan-main">
                <div className="replan-title">{task.title}</div>
                <div className="replan-meta">
                  计划 {task.scheduledDate ?? '—'}
                  {task.dueAt ? ` · 截止 ${new Date(task.dueAt).toLocaleString('zh-CN')}` : ''}
                </div>
              </div>
              <div className="replan-actions">
                <button title="完成 (D)" onClick={() => void act(task, 'complete')}>
                  <Check size={13} /> 完成
                </button>
                <button title="今天 (T)" onClick={() => void act(task, 'today')}>
                  <CalendarDays size={13} /> 今天
                </button>
                <button title="明天 (M)" onClick={() => void act(task, 'tomorrow')}>
                  明天
                </button>
                <button
                  title="选日期 (S 是也许)"
                  onClick={() => setDateFor(dateFor === task.id ? null : task.id)}
                >
                  选日期
                </button>
                <button title="移到也许" onClick={() => void act(task, 'someday')}>
                  <Moon size={13} /> 也许
                </button>
              </div>
              {dateFor === task.id && (
                <input
                  type="date"
                  className="replan-date"
                  autoFocus
                  onChange={(event) => {
                    if (!event.target.value) return
                    void act(task, 'date', event.target.value)
                    setDateFor(null)
                  }}
                />
              )}
            </div>
          ))}
        </div>

        <div className="replan-foot">
          <span className="replan-hint">
            <kbd>J</kbd>/<kbd>K</kbd> 选择 · <kbd>D</kbd> 完成 · <kbd>T</kbd> 今天 · <kbd>M</kbd> 明天 ·{' '}
            <kbd>S</kbd> 也许 · <kbd>Esc</kbd> 关闭
          </span>
          <div className="replan-foot-actions">
            {tasks.length > 1 && (
              <button className="ghost-btn" onClick={() => void postponeAll()}>
                <Inbox size={14} /> 全部顺延到今天
              </button>
            )}
            <button className="primary-btn" onClick={() => void finish()}>
              完成清理
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
