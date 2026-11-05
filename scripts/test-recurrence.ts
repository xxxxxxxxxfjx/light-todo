import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { initDb, createTask, setTaskStatus, listTasks, getDueReminders } from '../src/main/db.ts'
import { format, addDays } from 'date-fns'

const dir = join(process.cwd(), '.tmp', 'qa', 'recur')
rmSync(dir, { recursive: true, force: true })
initDb(dir)

const today = new Date()
today.setHours(9, 0, 0, 0)
const tomorrow = addDays(today, 1)

const t = createTask({
  title: '每日站会',
  dueAt: today.toISOString(),
  scheduledDate: format(today, 'yyyy-MM-dd'),
  rrule: 'FREQ=DAILY',
  repeatFrom: 'due',
  reminderOffset: 5
})
console.log('created', t.scheduledDate, t.rrule, t.reminderOffset, t.reminderAt)

setTaskStatus(t.id, true)
const upcoming = listTasks({ view: 'upcoming' })
console.log('upcoming after complete', upcoming.map((x) => [x.title, x.scheduledDate, x.dueAt, x.rrule]))

const todayList = listTasks({ view: 'today' })
console.log('today after complete', todayList.map((x) => [x.title, x.status]))

const due = getDueReminders(addDays(new Date(), 1).toISOString())
console.log('due reminders tomorrow', due.map((x) => [x.title, x.reminderAt]))

const child = createTask({ title: '子步骤', parentId: t.id })
console.log('child list', child.listId)

const next=upcoming.find(x=>x.title==='每日站会')!
assert.ok(next)
assert.equal(next.scheduledDate,format(tomorrow,'yyyy-MM-dd'))
assert.equal(next.rrule,'FREQ=DAILY')
assert.equal(next.reminderOffset,5)
assert.equal(todayList.some(x=>x.id===t.id),false)
assert.ok(due.some(x=>x.id===next.id))
console.log('PASS 重复任务和提醒断言')
