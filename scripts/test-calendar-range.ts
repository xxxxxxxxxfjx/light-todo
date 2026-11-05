import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import * as db from '../src/main/db.ts'

const directory = mkdtempSync(join(process.cwd(), '.qa-calendar-range-'))
db.initDb(directory)
try {
  const prefix = 'calendar-range:'
  const create = (title: string, patch: Parameters<typeof db.createTask>[0]) => db.createTask({ ...patch, title: prefix + title })
  const localIso = (day: number, hour = 0, minute = 0) => new Date(2026, 10, day, hour, minute).toISOString()
  create('start', { title: '', dueAt: localIso(4) })
  create('end', { title: '', dueAt: localIso(4, 23, 59) })
  create('next-day', { title: '', dueAt: localIso(5) })
  create('planned', { title: '', scheduledDate: '2026-11-04', dueAt: localIso(10) })
  create('planned-elsewhere', { title: '', scheduledDate: '2026-11-10', dueAt: localIso(4) })
  const completed = create('completed', { title: '', scheduledDate: '2026-11-04' })
  db.setTaskStatus(completed.id, true)
  const removed = create('deleted', { title: '', scheduledDate: '2026-11-04' })
  db.deleteTask(removed.id)
  db.transaction(() => {
    for (let i = 0; i < 4000; i++) create(`old-${i}`, { title: '', scheduledDate: '2020-01-01' })
    for (let i = 0; i < 4000; i++) create(`inbox-${i}`, { title: '' })
  })
  const start = performance.now()
  const all = db.listTasks({ view: 'calendar', limit: -1 })
  const fullMs = performance.now() - start
  const scopedStart = performance.now()
  const scoped = db.listTasks({ view: 'calendar', limit: -1, dateFrom: '2026-11-04', dateTo: '2026-11-04' })
  const scopedMs = performance.now() - scopedStart
  assert.deepEqual(scoped.filter(t => t.title.startsWith(prefix)).map(t => t.title.slice(prefix.length)).sort(), ['completed', 'end', 'planned', 'start'])
  const broad = db.listTasks({ view: 'calendar', limit: -1, dateFrom: '2020-01-01', dateTo: '2026-11-10' })
  assert.ok(broad.length > 4000, '跳转历史日期后仍须完整显示，不能用条数截断')
  console.log(`PASS 日历范围：本地日期边界、计划日优先、已完成保留、删除过滤、历史日期跳转。全量 ${all.length} 条 / ${fullMs.toFixed(1)}ms，范围 ${scoped.length} 条 / ${scopedMs.toFixed(1)}ms`)
} finally { db.closeDb() }
