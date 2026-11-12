import { useEffect, useRef, useState } from 'react'
import { BellRing, CalendarDays, Check, Flag, ListTodo, Moon, Play, Plus, Repeat, Square, Trash2, X, Zap } from 'lucide-react'
import type { ListSection } from '@shared/types'
import { useStore } from '../store'
import { mod, modKey } from '../lib/platform'
import { humanDate, isoToLocalInput, localInputToIso, todayStr } from '../lib/format'
import type { Task } from '@shared/types'
import { repeatLabel } from '../lib/repeat'
import { parseMarkdown, toggleChecklistLine } from '../lib/markdown'
import { MarkdownView } from './MarkdownView'

function minutesLabel(minutes: number | null): string {
  const value = Math.max(0, Math.round(minutes ?? 0))
  if (value < 60) return `${value} 分钟`
  const hours = Math.floor(value / 60)
  const rest = value % 60
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
}

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className="field-value">{children}</div>
    </div>
  )
}

export function DetailPanel(): React.JSX.Element {
  const {
    selected,
    sidebar,
    updateTask,
    deleteTask,
    selectTask,
    toggleTask,
    refresh,
    refreshSidebar,
    showToast,
    timer,
    startTimer,
    stopTimer
  } = useStore()
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [notesMode, setNotesMode] = useState<'edit' | 'preview'>('edit')
  const [sections, setSections] = useState<ListSection[]>([])
  const notesRef = useRef<HTMLTextAreaElement>(null)
  const [tagText, setTagText] = useState('')
  const [subDraft, setSubDraft] = useState('')
  const addingSubtask = useRef(false)

  useEffect(() => {
    const listId = selected?.listId ?? null
    if (!listId) {
      setSections([])
      return
    }
    let alive = true
    window.api.sections
      .list(listId)
      .then((rows) => {
        if (alive) setSections(rows)
      })
      .catch(() => {
        if (alive) setSections([])
      })
    return () => {
      alive = false
    }
  }, [selected?.listId])

  useEffect(() => {
    setTitle(selected?.title ?? '')
    setNotes(selected?.notes ?? '')
    setNotesMode('edit')
    setTagText((selected?.tags ?? []).map((t) => t.name).join(' '))
    setSubDraft('')
  }, [selected?.id])

  if (!selected) return <Overview />

  const task = selected

  const saveTitle = (): void => {
    const value = title.trim()
    if (!value) {
      setTitle(task.title)
      showToast('任务标题不能为空')
      return
    }
    if (value !== task.title) updateTask(task.id, { title: value })
  }
  const saveNotes = (): void => {
    // 以 DOM 实际值为准，避免输入法/程序化输入导致 state 未同步时丢备注
    const value = notesRef.current?.value ?? notes
    if (value !== task.notes) updateTask(task.id, { notes: value })
  }
  const toggleChecklist = (line: number): void => {
    const next = toggleChecklistLine(notes, line)
    if (next === notes) return
    setNotes(next)
    updateTask(task.id, { notes: next })
  }
  const saveTags = (): void => {
    const names = tagText
      .split(/[\s,，]+/)
      .map((s) => s.replace(/^#/, '').trim())
      .filter(Boolean)
    const unchanged =
      names.length === task.tags.length && names.every((n) => task.tags.some((t) => t.name === n))
    if (!unchanged) updateTask(task.id, { tagNames: names })
  }

  const refreshIfStillSelected = async (): Promise<void> => {
    await Promise.all([refresh(), refreshSidebar()])
    if (useStore.getState().selected?.id === task.id) await selectTask(task.id)
  }

  const addSubtask = async (): Promise<void> => {
    const t = subDraft.trim()
    if (!t || addingSubtask.current) return
    addingSubtask.current = true
    try {
      await window.api.tasks.create({ title: t, parentId: task.id })
      setSubDraft('')
      await refreshIfStillSelected()
    } catch (error) { useStore.getState().showToast(`添加子任务失败：${String(error)}`) }
    finally { addingSubtask.current = false }
  }

  return (
    <aside className="detail">
      <div className="detail-head">
        <span>任务详情</span>
        <button className="icon-btn" onClick={() => selectTask(null)} title="关闭">
          <X size={15} />
        </button>
      </div>

      <div className="detail-body">
        <div className="detail-title-row">
          <button
            className={`check big ${task.status === 1 ? 'checked' : ''}`}
            onClick={() => toggleTask(task.id)}
          >
            <Check size={13} strokeWidth={3} />
          </button>
          <textarea
            className={`detail-title ${task.status === 1 ? 'done' : ''}`}
            value={title}
            rows={2}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                ;(e.target as HTMLTextAreaElement).blur()
              }
            }}
          />
        </div>

        <div className="fields">
          <Field label="清单">
            <select
              value={task.listId ?? ''}
              onChange={(e) => updateTask(task.id, { listId: e.target.value || null })}
            >
              <option value="">未分类</option>
              {sidebar.lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="计划日">
            <input
              type="date"
              value={task.scheduledDate ?? ''}
              onChange={(e) => updateTask(task.id, { scheduledDate: e.target.value || null })}
            />
          </Field>

          <Field label="截止">
            <input
              type="datetime-local"
              value={isoToLocalInput(task.dueAt)}
              onChange={(e) =>
                updateTask(task.id, {
                  dueAt: localInputToIso(e.target.value),
                  dueAllDay: 0
                })
              }
            />
          </Field>

          <Field label="提醒">
            <select
              value={task.reminderOffset === null ? '' : String(task.reminderOffset)}
              disabled={!task.scheduledDate && !task.dueAt}
              title={
                !task.scheduledDate && !task.dueAt
                  ? '请先设置计划日或截止时间'
                  : '提醒会在设定时间弹出系统通知'
              }
              onChange={(e) =>
                updateTask(task.id, {
                  reminderOffset: e.target.value === '' ? null : Number(e.target.value)
                })
              }
            >
              <option value="">不提醒</option>
              <option value="0">准时</option>
              <option value="5">提前 5 分钟</option>
              <option value="15">提前 15 分钟</option>
              <option value="60">提前 1 小时</option>
              <option value="1440">提前 1 天</option>
            </select>
          </Field>

          <Field label="估时">
            <select
              aria-label="预计用时"
              value={task.estimateMin === null ? '' : String(task.estimateMin)}
              onChange={(e) =>
                updateTask(task.id, { estimateMin: e.target.value === '' ? null : Number(e.target.value) })
              }
            >
              <option value="">不估时</option>
              {[15, 30, 45, 60, 90, 120, 180, 240].map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes >= 60 ? `${minutes / 60} 小时` : `${minutes} 分钟`}
                </option>
              ))}
            </select>
          </Field>

          {sections.length > 0 && (
            <Field label="分区">
              <select
                aria-label="所属分区"
                value={task.sectionId ?? ''}
                onChange={(e) => updateTask(task.id, { sectionId: e.target.value || null })}
              >
                <option value="">未分区</option>
                {sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="催办">
            <div className="inline-controls">
              <select
                aria-label="持续提醒"
                value={task.escalateInterval === null ? '' : String(task.escalateInterval)}
                onChange={(e) => {
                  const value = e.target.value === '' ? null : Number(e.target.value)
                  updateTask(task.id, {
                    escalateInterval: value,
                    escalateUntil: value ? new Date(Date.now() + 8 * 3600_000).toISOString() : null
                  })
                }}
              >
                <option value="">只提醒一次</option>
                <option value="15">每 15 分钟</option>
                <option value="30">每 30 分钟</option>
                <option value="60">每 1 小时</option>
                <option value="240">每 4 小时</option>
              </select>
              <label className="check-inline" title="到点弹置顶强提醒">
                <input
                  type="checkbox"
                  checked={task.urgent}
                  onChange={(e) => updateTask(task.id, { urgent: e.target.checked })}
                />
                紧急
              </label>
            </div>
          </Field>

          <Field label="优先级">
            <div className="segmented">
              {[
                { v: 0, label: '无' },
                { v: 1, label: '低' },
                { v: 2, label: '中' },
                { v: 3, label: '高' }
              ].map((p) => (
                <button
                  key={p.v}
                  className={`seg ${task.priority === p.v ? 'active' : ''}`}
                  data-p={p.v}
                  onClick={() => updateTask(task.id, { priority: p.v })}
                >
                  {p.v > 0 && <Flag size={10} />}
                  {p.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="标签">
            <input
              type="text"
              placeholder="用空格分隔，如：汇报 紧急"
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              onBlur={saveTags}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                if (e.key === 'Enter') {
                  e.preventDefault()
                  ;(e.target as HTMLInputElement).blur()
                }
              }}
            />
          </Field>
          <Field label="重复">
            <select aria-label="重复频率" value={task.rrule ?? ''} onChange={e => updateTask(task.id, {
              rrule: e.target.value || null,
              ...(e.target.value && !task.scheduledDate && !task.dueAt ? {scheduledDate:todayStr()} : {})
            })}>
              <option value="">不重复</option>
              {['FREQ=DAILY','FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR','FREQ=WEEKLY','FREQ=MONTHLY','FREQ=YEARLY'].map(rule => <option key={rule} value={rule}>{repeatLabel(rule)}</option>)}
              {task.rrule && !['FREQ=DAILY','FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR','FREQ=WEEKLY','FREQ=MONTHLY','FREQ=YEARLY'].includes(task.rrule) && <option value={task.rrule}>{repeatLabel(task.rrule)}</option>}
            </select>
          </Field>
          {task.rrule && <Field label="重复方式"><select aria-label="重复方式" value={task.repeatFrom ?? 'due'} onChange={e => updateTask(task.id,{repeatFrom:e.target.value as 'due' | 'completion'})}><option value="due">按计划日期</option><option value="completion">按完成日期</option></select></Field>}
        </div>

        <div className="timer-row">
          <span className="timer-label">
            <Zap size={13} /> 实际用时 {minutesLabel(task.actualMin)}
          </span>
          {timer?.taskId === task.id ? (
            <button className="inline-action active" onClick={() => void stopTimer()}>
              <Square size={13} /> 停止计时
            </button>
          ) : (
            <button
              className="inline-action"
              onClick={() => startTimer(task.id)}
              disabled={!!timer}
              title={timer ? '已有另一个任务在计时' : '开始为这个任务计时'}
            >
              <Play size={13} /> 开始计时
            </button>
          )}
        </div>

        <div className="detail-quick-actions">
          {(!task.scheduledDate || task.someday) && (
            <button
              className="inline-action"
              onClick={() => updateTask(task.id, { scheduledDate: todayStr(), someday: false })}
            >
              <CalendarDays size={14} /> 安排到今天
            </button>
          )}
          {task.someday ? (
            <span className="someday-state"><Moon size={13}/> 已在也许</span>
          ) : (
            <button
              className="inline-action"
              onClick={() =>
                updateTask(task.id, { someday: true, scheduledDate: null, dueAt: null })
              }
            >
              <Moon size={14} /> 移到也许
            </button>
          )}
        </div>

        <div className="detail-section">
          <div className="detail-section-head">
            <ListTodo size={14} />
            <span>子任务</span>
            {task.subtasks && task.subtasks.length > 0 && (
              <em>
                {task.subtasks.filter((s) => s.status === 1).length}/{task.subtasks.length}
              </em>
            )}
          </div>
          <div className="subtasks">
            {(task.subtasks ?? []).map((s) => (
              <div key={s.id} className={`subtask ${s.status === 1 ? 'done' : ''}`}>
                <button
                  className={`check small ${s.status === 1 ? 'checked' : ''}`}
                  onClick={async () => {
                    await window.api.tasks.setStatus(s.id, s.status !== 1)
                    await refreshIfStillSelected()
                  }}
                >
                  <span className="check-dot" />
                </button>
                <span>{s.title}</span>
              </div>
            ))}
            <div className="subtask-add">
              <Plus size={13} />
              <input
                value={subDraft}
                placeholder="添加子任务，回车保存"
                onChange={(e) => setSubDraft(e.target.value)}
                onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                  if (e.key === 'Enter') addSubtask()
                }}
              />
              <button className="subtask-add-btn" onClick={addSubtask}>
                添加
              </button>
            </div>
          </div>
        </div>

        <div className="detail-section">
          <div className="detail-section-head">
            <span>备注</span>
            <div className="notes-tabs">
              <button
                className={`notes-tab ${notesMode === 'edit' ? 'active' : ''}`}
                onClick={() => setNotesMode('edit')}
              >
                编辑
              </button>
              <button
                className={`notes-tab ${notesMode === 'preview' ? 'active' : ''}`}
                onClick={() => {
                  saveNotes()
                  setNotesMode('preview')
                }}
              >
                预览
              </button>
            </div>
          </div>
          {notesMode === 'edit' ? (
            <textarea
              ref={notesRef}
              className="notes"
              placeholder="支持 Markdown：**加粗**、- 列表、- [ ] 步骤、[链接](https://…)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={saveNotes}
            />
          ) : (
            <div className="notes-preview">
              <MarkdownView
                blocks={parseMarkdown(notes)}
                onToggleChecklist={toggleChecklist}
                onOpenLink={(href) => {
                  void window.api.app.openExternal(href)
                }}
              />
            </div>
          )}
        </div>

        {task.rrule && (
          <div className="repeat-badge">
            <Repeat size={13} />
            <span>{repeatLabel(task.rrule)} · {task.repeatFrom === 'completion' ? '按完成日期' : '按计划日期'}</span>
          </div>
        )}
      </div>

      <div className="detail-foot">
        <span className="created">创建于 {new Date(task.createdAt).toLocaleDateString('zh-CN')}</span>
        <button className="danger-btn" onClick={() => deleteTask(task.id)}>
          <Trash2 size={14} /> 删除
        </button>
      </div>
    </aside>
  )
}

function Overview(): React.JSX.Element {
  const { sidebar } = useStore()
  // The sidebar already counts today's tasks in SQLite. Re-querying the whole
  // today list here duplicated the main list IPC on every task change.
  const todayCount = sidebar.counts.today ?? 0
  const high = sidebar.counts.todayHigh ?? 0

  return (
    <aside className="detail overview">
      <div className="detail-head">
        <span>今日概览</span>
      </div>
      <div className="overview-body">
        <div className="ov-date">{humanDate()}</div>
        <div className="ov-big">
          {todayCount}
          <span>项待办</span>
        </div>
        <div className="ov-row">
          <div className="ov-card">
            <em>{high}</em>
            <span>高优先级</span>
          </div>
          <div className="ov-card">
            <em>{sidebar.counts.upcoming ?? 0}</em>
            <span>未来 7 天</span>
          </div>
        </div>
        <div className="ov-tip">
          <div className="ov-tip-title">快速上手</div>
          <ul>
            <li>
              <kbd>{mod}</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd> 全局记一条
            </li>
            <li>
              输入 <code>明天下午3点 交周报 #工作 @汇报 !高</code>
            </li>
            <li>
              <kbd>Space</kbd> 完成选中任务，<kbd>{modKey('F')}</kbd> 搜索
            </li>
          </ul>
        </div>
      </div>
    </aside>
  )
}
