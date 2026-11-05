import { useEffect, useMemo, useState } from 'react'
import { addDays, format, startOfDay } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Inbox,
  ListTodo,
  PlusCircle,
  RefreshCw
} from 'lucide-react'
import type { WeeklyReviewData } from '@shared/types'
import { useStore } from '../store'
import { parseLocalDate } from '../lib/format'
import '../review.css'

const METRICS = [
  { key: 'completed', label: '最近 7 天完成', note: '已经收尾的任务', icon: CheckCircle2 },
  { key: 'created', label: '最近 7 天新增', note: '这段时间的新任务', icon: PlusCircle },
  { key: 'overdue', label: '当前逾期', note: '需要尽快处理', icon: AlertTriangle },
  { key: 'active', label: '当前待办', note: '所有未完成任务', icon: ListTodo }
] as const

function dateRangeText(first?: string, last?: string): string {
  if (!first || !last) return '最近 7 天'
  const start = parseLocalDate(first)
  const end = parseLocalDate(last)
  if (start.getFullYear() === end.getFullYear()) {
    return `${format(start, 'yyyy年M月d日')} – ${format(end, 'M月d日')}`
  }
  return `${format(start, 'yyyy年M月d日')} – ${format(end, 'yyyy年M月d日')}`
}

export function WeeklyReview(): React.JSX.Element {
  const { setView } = useStore()
  const [data, setData] = useState<WeeklyReviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    let requestId = 0
    const load = async (): Promise<void> => {
      const request = ++requestId
      setLoading(true)
      setError('')
      try {
        const next = await window.api.review.get()
        if (!cancelled && request === requestId) setData(next)
      } catch (err) {
        console.error(err)
        if (!cancelled && request === requestId) setError('周复盘加载失败，请重试')
      } finally {
        if (!cancelled && request === requestId) setLoading(false)
      }
    }
    void load()
    // 复盘打开时也可能通过快捷添加/详情改动任务；本地变更后静默刷新统计。
    const off = window.api.onTasksChanged(() => {
      void load()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [reloadKey])

  const fallbackDays = useMemo(() => {
    const end = startOfDay(new Date())
    return Array.from({ length: 7 }, (_, index) => ({
      date: format(addDays(end, index - 6), 'yyyy-MM-dd'),
      completed: 0,
      created: 0
    }))
  }, [])

  const days = data?.days ?? fallbackDays
  const maxValue = Math.max(1, ...days.flatMap((day) => [day.completed, day.created]))
  const todayKey = days[days.length - 1]?.date ?? format(new Date(), 'yyyy-MM-dd')
  const rangeText = dateRangeText(days[0]?.date, days[days.length - 1]?.date)
  const sortedLists = useMemo(
    () =>
      [...(data?.lists ?? [])].sort(
        (a, b) =>
          b.completed - a.completed ||
          b.active - a.active ||
          a.name.localeCompare(b.name, 'zh-CN')
      ),
    [data?.lists]
  )
  const empty =
    !!data &&
    data.completed === 0 &&
    data.created === 0 &&
    data.overdue === 0 &&
    data.active === 0 &&
    sortedLists.every((list) => list.completed === 0 && list.active === 0)

  const openToday = (): void => {
    void setView('today', { title: '今天' })
  }
  const openInbox = (): void => {
    void setView('inbox', { title: '收件箱' })
  }

  return (
    <section className="main review-main" aria-busy={loading}>
      <header className="main-head review-head">
        <div className="main-title">
          <h1>周复盘</h1>
          <span className="main-count">{rangeText}</span>
        </div>
        <div className="head-actions review-actions">
          <button className="ghost-btn" onClick={openToday}>
            <CalendarDays size={15} />
            回到今天
          </button>
          <button className="ghost-btn" onClick={openInbox}>
            <Inbox size={15} />
            打开收件箱
          </button>
        </div>
      </header>

      <div className="review-scroll">
        {loading && !data ? (
          <div className="review-state" role="status">
            <RefreshCw size={22} className="review-spin" />
            <h2>正在读取本地数据</h2>
            <p>统计来自本机 SQLite，不会联网。</p>
          </div>
        ) : error && !data ? (
          <div className="review-state" role="alert">
            <AlertTriangle size={22} className="review-state-error" />
            <h2>周复盘加载失败</h2>
            <p>{error}</p>
            <button className="mini-btn" onClick={() => setReloadKey((key) => key + 1)}>
              重试
            </button>
          </div>
        ) : data ? (
          <>
            {error && (
              <div className="review-error" role="alert">
                <span>{error}</span>
                <button className="mini-btn" onClick={() => setReloadKey((key) => key + 1)}>
                  重试
                </button>
              </div>
            )}

            <div className="review-metrics">
              {METRICS.map(({ key, label, note, icon: Icon }) => {
                const value = data[key]
                return (
                  <article
                    key={key}
                    className={`review-metric ${key === 'overdue' ? 'is-overdue' : ''}`}
                  >
                    <div className="review-metric-top">
                      <span className="review-metric-label">{label}</span>
                      <span className="review-metric-icon" aria-hidden="true">
                        <Icon size={16} />
                      </span>
                    </div>
                    <strong className="review-metric-value">{value}</strong>
                    <span className="review-metric-note">{note}</span>
                  </article>
                )
              })}
            </div>

            {empty ? (
              <div className="review-empty">
                <span className="review-empty-icon" aria-hidden="true">
                  <BarChart3 size={24} />
                </span>
                <h2>最近 7 天还没有任务动态</h2>
                <p>完成或新增任务后，这里会出现每天的节奏和清单分布。</p>
                <button className="primary-btn" onClick={openInbox}>
                  <Inbox size={15} />
                  打开收件箱
                </button>
              </div>
            ) : (
              <div className="review-grid">
                <section className="review-panel review-chart-panel" aria-labelledby="review-chart-title">
                  <div className="review-panel-head">
                    <div>
                      <h2 id="review-chart-title">近 7 天节奏</h2>
                      <p>每天完成与新增的任务数量</p>
                    </div>
                    <div className="review-legend" aria-label="图例">
                      <span className="is-completed">
                        <i aria-hidden="true" />完成
                      </span>
                      <span className="is-created">
                        <i aria-hidden="true" />新增
                      </span>
                    </div>
                  </div>

                  <div className="review-chart" role="list" aria-label="最近 7 天完成与新增任务">
                    {days.map((day) => {
                      const date = parseLocalDate(day.date)
                      const completedHeight = (day.completed / maxValue) * 100
                      const createdHeight = (day.created / maxValue) * 100
                      const isToday = day.date === todayKey
                      return (
                        <div
                          key={day.date}
                          className={`review-day ${isToday ? 'is-today' : ''}`}
                          role="listitem"
                          aria-label={`${format(date, 'M月d日')}：完成 ${day.completed} 项，新增 ${day.created} 项`}
                        >
                          <div className="review-bars" aria-hidden="true">
                            <span
                              className="review-bar is-completed"
                              style={{ height: `${completedHeight}%` }}
                            />
                            <span
                              className="review-bar is-created"
                              style={{ height: `${createdHeight}%` }}
                            />
                          </div>
                          <div className="review-day-label">
                            <strong>{format(date, 'M/d')}</strong>
                            <span>{format(date, 'EEE', { locale: zhCN })}</span>
                          </div>
                          <div className="review-day-stats">
                            <span className="is-completed">完成 {day.completed}</span>
                            <span className="is-created">新增 {day.created}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>

                <section className="review-panel review-lists-panel" aria-labelledby="review-lists-title">
                  <div className="review-panel-head">
                    <div>
                      <h2 id="review-lists-title">清单分布</h2>
                      <p>最近 7 天完成 / 当前待办</p>
                    </div>
                  </div>

                  {sortedLists.length === 0 ? (
                    <div className="review-list-empty">还没有清单，任务都在未分类里。</div>
                  ) : (
                    <ul className="review-lists">
                      {sortedLists.map((list) => (
                        <li
                          key={list.id || 'unclassified'}
                          className={`review-list-row ${list.id ? '' : 'is-unclassified'}`}
                        >
                          <span
                            className="review-list-dot"
                            style={{ background: list.color ?? (list.id ? 'var(--accent)' : 'var(--text-3)') }}
                            aria-hidden="true"
                          />
                          <span className="review-list-name">{list.name}</span>
                          <span className="review-list-counts">
                            <span
                              className="review-list-count is-completed"
                              title="最近 7 天完成"
                              aria-label={`最近 7 天完成 ${list.completed} 项`}
                            >
                              {list.completed}
                            </span>
                            <span
                              className="review-list-count is-active"
                              title="当前待办"
                              aria-label={`当前待办 ${list.active} 项`}
                            >
                              {list.active}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="review-lists-foot">
                    <span><i className="is-completed" aria-hidden="true" />完成</span>
                    <span><i className="is-active" aria-hidden="true" />待办</span>
                    <em>仅统计未删除任务</em>
                  </div>
                </section>
              </div>
            )}
          </>
        ) : null}
      </div>
    </section>
  )
}
