import type { List, Task } from '../shared/types'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function localDateTime(d: Date): string {
  return `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function icsDate(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}

function icsLocalDateTime(d: Date): string {
  return `${icsDate(d)}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function icsUtc(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(
    d.getUTCHours()
  )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function priorityLabel(priority: number): string {
  if (priority === 3) return '高'
  if (priority === 2) return '中'
  if (priority === 1) return '低'
  return '无'
}

/** Escape a value for an iCalendar TEXT property (RFC 5545 §3.3.11). */
function icsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
}

/**
 * Build a UTF-8 (BOM-prefixed) RFC 4180 CSV of all supplied tasks.
 * `lists` is optional because Task only carries listId; without it the
 * 清单 column is left empty.
 */
export function buildTaskCsv(tasks: Task[], lists: List[] = []): string {
  const listName = new Map(lists.map((l) => [l.id, l.name]))
  const rows: string[][] = [['标题', '清单', '标签', '优先级', '计划日', '截止时间', '完成状态', '备注']]
  for (const t of tasks) {
    const due = t.dueAt ? new Date(t.dueAt) : null
    rows.push([
      t.title,
      t.listId ? (listName.get(t.listId) ?? '') : '',
      (t.tags ?? []).map((tag) => tag.name).join('、'),
      priorityLabel(t.priority),
      t.scheduledDate ?? '',
      due && !Number.isNaN(due.getTime()) ? localDateTime(due) : '',
      t.status === 1 ? '已完成' : '未完成',
      t.notes ?? ''
    ])
  }
  return `\uFEFF${rows.map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`
}

/**
 * Build an iCalendar feed with one VEVENT per live task that has a planned
 * date or a due time. All-day events use VALUE=DATE; timed events are written
 * as floating local time (no Z), while DTSTAMP is UTC.
 */
export function buildIcs(tasks: Task[], now: Date = new Date()): string {
  const stamp = icsUtc(Number.isNaN(now.getTime()) ? new Date() : now)
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LightTodo//CN',
    'CALSCALE:GREGORIAN'
  ]
  for (const t of tasks) {
    if (t.deletedAt) continue
    const due = t.dueAt ? new Date(t.dueAt) : null
    const hasDue = !!due && !Number.isNaN(due.getTime())
    let start: string | null = null
    if (hasDue && !t.dueAllDay) {
      start = `DTSTART:${icsLocalDateTime(due!)}`
    } else if (t.scheduledDate) {
      start = `DTSTART;VALUE=DATE:${t.scheduledDate.replace(/-/g, '')}`
    } else if (hasDue) {
      start = `DTSTART;VALUE=DATE:${icsDate(due!)}`
    }
    if (!start) continue
    lines.push('BEGIN:VEVENT')
    lines.push(start)
    lines.push(`UID:${t.id}@lighttodo`)
    lines.push(`DTSTAMP:${stamp}`)
    lines.push(`SUMMARY:${icsText(t.title)}`)
    if (t.notes && t.notes.trim()) lines.push(`DESCRIPTION:${icsText(t.notes)}`)
    if (t.rrule) lines.push(`RRULE:${t.rrule}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return `${lines.join('\r\n')}\r\n`
}
