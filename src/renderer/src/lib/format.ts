import { differenceInCalendarDays, format, isToday, isTomorrow, isValid, parseISO } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import type { Task } from '@shared/types'

export function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

export function dateLabel(s: string): string {
  const d = parseLocalDate(s)
  if (!isValid(d)) return '日期无效'
  const diff = differenceInCalendarDays(d, new Date())
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === 2) return '后天'
  if (diff === -1) return '昨天'
  if (diff < 0) return `${-diff} 天前`
  if (diff < 7) return format(d, 'EEEE', { locale: zhCN })
  if (d.getFullYear() === new Date().getFullYear()) return format(d, 'M月d日')
  return format(d, 'yyyy年M月d日')
}

export function dueLabel(task: Task): { text: string; tone: 'normal' | 'overdue' | 'muted' } {
  if (task.status === 1) return { text: '已完成', tone: 'muted' }
  if (task.dueAt) {
    const d = new Date(task.dueAt)
    if (!isValid(d)) return { text: '日期无效', tone: 'muted' }
    const diff = differenceInCalendarDays(d, new Date())
    const time = format(d, 'HH:mm')
    if (d.getTime() < Date.now()) return { text: `${format(d, 'M月d日')} ${time}`, tone: 'overdue' }
    if (diff === 0) return { text: time, tone: 'normal' }
    if (diff === 1) return { text: `明天 ${time}`, tone: 'normal' }
    return { text: `${format(d, 'M月d日')} ${time}`, tone: 'normal' }
  }
  if (task.scheduledDate) {
    const d = parseLocalDate(task.scheduledDate)
    if (!isValid(d)) return { text: '日期无效', tone: 'muted' }
    const diff = differenceInCalendarDays(d, new Date())
    return { text: dateLabel(task.scheduledDate), tone: diff < 0 ? 'overdue' : 'normal' }
  }
  return { text: '', tone: 'muted' }
}

export function groupLabel(task: Task): string {
  if (task.scheduledDate) return dateLabel(task.scheduledDate)
  if (task.dueAt) {
    const d = new Date(task.dueAt)
    if (!isValid(d)) return '日期无效'
    if (isToday(d)) return '今天'
    if (isTomorrow(d)) return '明天'
    return format(d, 'M月d日 EEEE', { locale: zhCN })
  }
  return '无日期'
}

export function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function localInputToIso(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

export function todayStr(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

export function humanDate(d: Date = new Date()): string {
  return format(d, 'M月d日 EEEE', { locale: zhCN })
}

export function parseISOOrNull(s: string | null): Date | null {
  if (!s) return null
  const d = parseISO(s)
  return isNaN(d.getTime()) ? null : d
}
