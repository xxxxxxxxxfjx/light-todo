import { useEffect, useMemo, useState } from 'react'
import { Copy, FileText, Image as ImageIcon, X } from 'lucide-react'
import { format } from 'date-fns'
import { parseCaptureText } from '@shared/capture-parse'
import { useStore } from '../store'

export function CaptureModal(): React.JSX.Element | null {
  const { capture, closeCapture, sidebar, createTask, showToast } = useStore()
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [listId, setListId] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [dueTime, setDueTime] = useState('')
  const [estimateMin, setEstimateMin] = useState('')
  const [priority, setPriority] = useState(0)
  const [tagText, setTagText] = useState('')
  const [saving, setSaving] = useState(false)

  const parsed = useMemo(() => {
    if (!capture) return null
    return parseCaptureText(capture.text || capture.lines.join('\n'))
  }, [capture])

  useEffect(() => {
    if (!capture) return
    setTitle(capture.text ? parsed?.title ?? '' : '')
    setNotes(capture.text)
    setListId('')
    setScheduledDate(parsed?.scheduledDate ?? '')
    setDueTime(parsed?.dueAt ? format(new Date(parsed.dueAt), 'HH:mm') : '')
    setEstimateMin(parsed?.estimateMin ? String(parsed.estimateMin) : '')
    setPriority(0)
    setTagText('')
  }, [capture, parsed])

  if (!capture) return null

  const copyImage = async (): Promise<void> => {
    try {
      await window.api.capture.copyImage(capture.image)
      showToast('截图已复制')
    } catch (error) {
      showToast(`复制图片失败：${String(error)}`)
    }
  }

  const copyText = async (): Promise<void> => {
    if (!capture.text) {
      showToast('没有可复制的文字')
      return
    }
    try {
      await window.api.capture.copyText(capture.text)
      showToast('识别文字已复制')
    } catch (error) {
      showToast(`复制文字失败：${String(error)}`)
    }
  }

  const save = async (): Promise<void> => {
    const clean = title.trim()
    if (!clean) {
      showToast('请填写任务标题')
      return
    }
    let dueAt: string | null = null
    const dateForSave = scheduledDate || (dueTime ? format(new Date(), 'yyyy-MM-dd') : '')
    if (dateForSave && dueTime) {
      const [y, m, d] = dateForSave.split('-').map(Number)
      const [hh, mm] = dueTime.split(':').map(Number)
      dueAt = new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0).toISOString()
    }
    setSaving(true)
    try {
      await createTask({
        title: clean,
        notes,
        listId: listId || null,
        scheduledDate: dateForSave || null,
        dueAt,
        dueAllDay: dateForSave && !dueTime ? 1 : 0,
        estimateMin: estimateMin ? Number(estimateMin) : null,
        priority,
        tagNames: tagText
          .split(/[\s,，]+/)
          .map((tag) => tag.replace(/^#/, '').trim())
          .filter(Boolean)
      })
      showToast('截图任务已保存')
      closeCapture()
    } catch (error) {
      showToast(`保存失败：${String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="overlay capture-overlay" onMouseDown={closeCapture}>
      <div
        className="capture-panel"
        role="dialog"
        aria-modal="true"
        aria-label="截图任务"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="capture-head">
          <div>
            <h2>截图任务</h2>
            <p>左侧是刚截的图，右侧是识别出的任务内容；都可以改。</p>
          </div>
          <button className="icon-btn" aria-label="关闭" onClick={closeCapture}>
            <X size={16} />
          </button>
        </div>

        <div className="capture-body">
          <div className="capture-left">
            <div className="capture-image-wrap">
              <img src={capture.image} alt="截图" />
            </div>
            <div className="capture-tools">
              <button className="ghost-btn" onClick={() => void copyImage()}>
                <ImageIcon size={14} /> 复制图片
              </button>
              <button className="ghost-btn" onClick={() => void copyText()} disabled={!capture.text}>
                <FileText size={14} /> 复制文字
              </button>
              <span className="capture-tool-hint">
                <Copy size={12} /> 可直接粘到微信
              </span>
            </div>
          </div>

          <div className="capture-right">
            <label className="capture-field">
              <span>标题</span>
              <input
                autoFocus
                value={title}
                placeholder="这条任务要做什么？"
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>

            <div className="capture-grid">
              <label className="capture-field">
                <span>清单</span>
                <select value={listId} onChange={(event) => setListId(event.target.value)}>
                  <option value="">收件箱</option>
                  {sidebar.lists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="capture-field">
                <span>计划日</span>
                <input
                  type="date"
                  value={scheduledDate}
                  onChange={(event) => setScheduledDate(event.target.value)}
                />
              </label>
              <label className="capture-field">
                <span>时间</span>
                <input type="time" value={dueTime} onChange={(event) => setDueTime(event.target.value)} />
              </label>
              <label className="capture-field">
                <span>估时</span>
                <select value={estimateMin} onChange={(event) => setEstimateMin(event.target.value)}>
                  <option value="">不估时</option>
                  {[15, 30, 45, 60, 90, 120, 180, 240].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes >= 60 ? `${minutes / 60} 小时` : `${minutes} 分钟`}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="capture-field">
              <span>优先级</span>
              <div className="segmented">
                {[
                  { value: 0, label: '无' },
                  { value: 1, label: '低' },
                  { value: 2, label: '中' },
                  { value: 3, label: '高' }
                ].map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={`seg ${priority === item.value ? 'active' : ''}`}
                    onClick={() => setPriority(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="capture-field">
              <span>标签</span>
              <input
                value={tagText}
                placeholder="用空格分隔，如：客户 会议"
                onChange={(event) => setTagText(event.target.value)}
              />
            </label>

            <label className="capture-field capture-notes">
              <span>
                备注 <em>OCR 原文，可改</em>
              </span>
              <textarea
                value={notes}
                placeholder={capture.text ? '' : '没有识别到文字，可以手动输入'}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="capture-foot">
          <span className="capture-status">
            {capture.text ? `已识别 ${capture.lines.length} 行，保存前可修改` : '未识别到文字，可手动填写'}
          </span>
          <div>
            <button className="ghost-btn" onClick={closeCapture}>
              取消
            </button>
            <button className="primary-btn" disabled={saving} onClick={() => void save()}>
              {saving ? '保存中…' : '保存任务'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
