import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, CheckCircle2, Coffee, Moon, Star, X } from 'lucide-react'
import { addDays, format, startOfDay } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import type { DayReview, Task } from '@shared/types'
import { useStore } from '../store'

const todayStr = (): string => format(new Date(), 'yyyy-MM-dd')

function endOfWeek(): string {
  const now = new Date()
  const day = now.getDay()
  return format(addDays(startOfDay(now), day === 0 ? 0 : 7 - day), 'yyyy-MM-dd')
}

export function ShutdownModal(): React.JSX.Element | null {
  const { shutdownOpen, closeShutdown, refresh, refreshSidebar, showToast } = useStore()
  const [completed, setCompleted] = useState<Task[]>([])
  const [unfinished, setUnfinished] = useState<Task[]>([])
  const [review, setReview] = useState<DayReview | null>(null)
  const [rating, setRating] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [completedTasks, todayTasks, dayReview] = await Promise.all([
        window.api.tasks.list({ view: 'completed', limit: 300 }),
        window.api.tasks.list({ view: 'today', limit: 500 }),
        window.api.review.day(todayStr())
      ])
      setCompleted(
        completedTasks.filter((task: Task) => {
          if (!task.completedAt) return false
          return format(new Date(task.completedAt), 'yyyy-MM-dd') === todayStr()
        })
      )
      setUnfinished(todayTasks.filter((task: Task) => task.status === 0))
      setReview(dayReview)
      setRating(dayReview?.rating ?? null)
      setNote(dayReview?.note ?? '')
    } catch (error) {
      showToast(`读取今日数据失败：${String(error)}`)
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    if (!shutdownOpen) return
    void load()
  }, [shutdownOpen, load])

  const moveTask = async (task: Task, target: 'tomorrow' | 'week' | 'someday'): Promise<void> => {
    const patch =
      target === 'tomorrow'
        ? { scheduledDate: format(addDays(new Date(), 1), 'yyyy-MM-dd'), someday: false }
        : target === 'week'
          ? { scheduledDate: endOfWeek(), someday: false }
          : { someday: true, scheduledDate: null, dueAt: null }
    await useStore.getState().updateTask(task.id, patch)
    setUnfinished((current) => current.filter((item) => item.id !== task.id))
  }

  const save = async (): Promise<void> => {
    try {
      await window.api.review.saveDay(todayStr(), rating, note)
      await Promise.all([refresh(), refreshSidebar()])
      showToast(review ? '今天已更新收尾' : '今天已收尾')
      closeShutdown()
    } catch (error) {
      showToast(`保存失败：${String(error)}`)
    }
  }

  const doneCount = useMemo(() => completed.length, [completed])

  if (!shutdownOpen) return null

  return (
    <div className="overlay" onMouseDown={closeShutdown}>
      <div className="shutdown-panel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="shutdown-head">
          <div>
            <h2>收工</h2>
            <p>{format(new Date(), 'M 月 d 日 EEEE', { locale: zhCN })} · 今天完成 {doneCount} 项</p>
          </div>
          <button className="icon-btn" aria-label="关闭" onClick={closeShutdown}>
            <X size={16} />
          </button>
        </div>

        {loading && <div className="shutdown-empty">正在整理今天…</div>}

        {!loading && (
          <div className="shutdown-body">
            <section className="shutdown-section">
              <h3>
                <CheckCircle2 size={14} /> 今天完成了
              </h3>
              {completed.length === 0 ? (
                <p className="shutdown-muted">还没有完成记录。</p>
              ) : (
                <ul className="shutdown-done">
                  {completed.slice(0, 12).map((task) => (
                    <li key={task.id}>{task.title}</li>
                  ))}
                  {completed.length > 12 && <li className="shutdown-muted">还有 {completed.length - 12} 项…</li>}
                </ul>
              )}
            </section>

            <section className="shutdown-section">
              <h3>
                <Coffee size={14} /> 没做完的（{unfinished.length}）
              </h3>
              {unfinished.length === 0 ? (
                <p className="shutdown-muted">今天清完了。</p>
              ) : (
                <div className="shutdown-unfinished">
                  {unfinished.map((task) => (
                    <div key={task.id} className="shutdown-task">
                      <span className="shutdown-task-title">{task.title}</span>
                      <span className="shutdown-task-actions">
                        <button onClick={() => void moveTask(task, 'tomorrow')}>明天</button>
                        <button onClick={() => void moveTask(task, 'week')}>本周</button>
                        <button onClick={() => void moveTask(task, 'someday')}>
                          <Moon size={11} /> 也许
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="shutdown-section">
              <h3>
                <Star size={14} /> 给今天打个分
              </h3>
              <div className="shutdown-rating">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    className={rating === value ? 'active' : ''}
                    onClick={() => setRating(value)}
                    aria-label={`${value} 分`}
                  >
                    <Star size={16} fill={rating !== null && value <= rating ? 'currentColor' : 'none'} />
                  </button>
                ))}
                <span className="shutdown-rating-label">
                  {rating ? ['', '很糟', '一般', '还行', '不错', '很好'][rating] : '未评分'}
                </span>
              </div>
              <textarea
                className="shutdown-note"
                placeholder="一句备注：今天什么做得好，什么明天要改？"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </section>
          </div>
        )}

        <div className="shutdown-foot">
          <span className="shutdown-hint">
            <CalendarDays size={12} /> 收尾不会挪动已完成的任务
          </span>
          <div>
            <button className="ghost-btn" onClick={closeShutdown}>
              先不收尾
            </button>
            <button className="primary-btn" onClick={() => void save()} disabled={loading}>
              {review ? '更新收尾' : '完成收尾'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
