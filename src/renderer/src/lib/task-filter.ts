import { format } from 'date-fns'
import type { Task } from '@shared/types'

export type TaskFilter = 'all' | 'overdue' | 'today' | 'high' | 'nodate'
export function isOverdue(t: Task): boolean {
  if (t.status === 1) return false
  const today = format(new Date(), 'yyyy-MM-dd')
  return (!!t.dueAt && new Date(t.dueAt).getTime() < Date.now()) ||
    (!!t.scheduledDate && t.scheduledDate < today)
}
export function matchFilter(t: Task, f: TaskFilter): boolean {
  if (f === 'high') return t.priority === 3
  if (f === 'nodate') return !t.scheduledDate && !t.dueAt && !t.someday
  if (f === 'overdue') return isOverdue(t)
  if (f === 'today') {
    const today = format(new Date(), 'yyyy-MM-dd')
    return t.scheduledDate === today || (!!t.dueAt && format(new Date(t.dueAt), 'yyyy-MM-dd') === today)
  }
  return true
}
