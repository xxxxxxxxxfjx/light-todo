import { useState } from 'react'
import { ChevronDown, Copy, FileText } from 'lucide-react'
import type { Task } from '@shared/types'
import { buildDayReport } from '../lib/day-report'

interface Props {
  dateKey: string
  tasks: Task[]
  open: boolean
  onToggle: () => void
  onNotify: (message: string) => void
}

export function DayReport({ dateKey, tasks, open, onToggle, onNotify }: Props): React.JSX.Element {
  const [copying, setCopying] = useState(false)
  const text = buildDayReport(dateKey, tasks)

  const copy = async (): Promise<void> => {
    if (copying) return
    setCopying(true)
    try {
      await navigator.clipboard.writeText(text)
      onNotify('日报已复制')
    } catch {
      onNotify('复制失败，请手动选择文本')
    } finally {
      setCopying(false)
    }
  }

  return (
    <div className={`day-report ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="day-report-toggle"
        title={open ? '收起日报' : '展开日报'}
        aria-expanded={open}
        aria-label={`${dateKey} 日报，${tasks.length} 项`}
        onClick={onToggle}
      >
        <FileText size={13} aria-hidden="true" />
        <span className="day-report-title">日报</span>
        <span className="day-report-count">{tasks.length} 项</span>
        <ChevronDown size={13} className="day-report-arrow" aria-hidden="true" />
      </button>
      {open && (
        <div className="day-report-body" role="region" aria-label={`${dateKey} 日报`}>
          <pre className="day-report-text">{text}</pre>
          <button type="button" className="day-report-copy" title="复制这一天的日报" onClick={() => void copy()} disabled={copying}>
            <Copy size={12} aria-hidden="true" />
            {copying ? '复制中' : '复制'}
          </button>
        </div>
      )}
    </div>
  )
}
