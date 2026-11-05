import { format } from 'date-fns'

/** 订阅日历的只读日程：来自 ICS 快照，不参与任务 CRUD。 */
export interface ExternalCalendarEvent {
  id: string
  title: string
  startAt: string
  endAt: string | null
  allDay: boolean
}

/** 把一个日程映射到它覆盖的本地日期；跨天日程在每一天都能看到。 */
export function eventDayKeys(event: ExternalCalendarEvent): string[] {
  const start = new Date(event.startAt)
  if (Number.isNaN(start.getTime())) return []
  const end = event.endAt ? new Date(event.endAt) : null
  const last = end && end.getTime() > start.getTime() ? new Date(end.getTime() - 1) : start
  const keys: string[] = []
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  // 异常长的订阅日程最多标记 31 天，避免坏数据撑爆月历。
  while (cursor <= last && keys.length < 31) {
    keys.push(format(cursor, 'yyyy-MM-dd'))
    cursor.setDate(cursor.getDate() + 1)
  }
  return keys
}

export function eventTimeLabel(event: ExternalCalendarEvent): string {
  if (event.allDay) return '全天'
  const start = new Date(event.startAt)
  return Number.isNaN(start.getTime()) ? '' : format(start, 'HH:mm')
}
