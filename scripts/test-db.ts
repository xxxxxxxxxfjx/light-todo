import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { initDb, createTask, updateTask, listTasks, setTaskStatus, searchTasks, getSidebar, createList, deleteTask, restoreTask, getTask } from '../src/main/db.ts'
import { format, addDays } from 'date-fns'

const dir = 'E:\\code\\todo\\.qa-db'
rmSync(dir, { recursive: true, force: true })
initDb(dir)

const today = format(new Date(), 'yyyy-MM-dd')
const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd')

const list = createList({ name: '测试清单' })
const a = createTask({ title: '今天的事', scheduledDate: today, priority: 3, tagNames: ['紧急'] })
const b = createTask({ title: '明天的事', scheduledDate: tomorrow })
const c = createTask({ title: '无清单的事' })
const listOnly = createTask({ title: '清单里无日期的事', listId: list.id })
const maybe = createTask({ title: '也许的事', someday: true })
const child = createTask({ title: '子任务', parentId: a.id })
const noted = createTask({ title: '备注任务', notes: 'NEVER-LOSE-ME', scheduledDate: today })

console.log('today', listTasks({ view: 'today' }).map((t) => t.title))
console.log('inbox', listTasks({ view: 'inbox' }).map((t) => t.title))
console.log('upcoming', listTasks({ view: 'upcoming' }).map((t) => t.title))
console.log('all', listTasks({ view: 'all' }).map((t) => t.title))
console.log('list', listTasks({ view: 'list', listId: list.id }).map((t) => t.title))
console.log('search', searchTasks('事').map((t) => t.title))
console.log('sidebar', JSON.stringify(getSidebar().counts))
console.log('detail', getTask(a.id)?.subtasks?.length)

setTaskStatus(a.id, true)
console.log('after complete today', listTasks({ view: 'today' }).map((t) => t.title))
console.log('after complete child', getTask(child.id)?.status)

deleteTask(b.id)
console.log('after delete upcoming', listTasks({ view: 'upcoming' }).map((t) => t.title))
restoreTask(b.id)
console.log('after restore upcoming', listTasks({ view: 'upcoming' }).map((t) => t.title))
assert.equal(getTask(a.id)?.subtasks?.length,1)
assert.equal(getTask(child.id)?.status,1)
assert.ok(listTasks({view:'upcoming'}).some(t=>t.id===b.id))
assert.ok(searchTasks('事').some(t=>t.id===a.id))
// List queries feed the virtual list; notes must survive so opening a task and
// clicking the notes box never writes an empty string back.
assert.equal(listTasks({ view: 'all' }).find((t) => t.id === noted.id)?.notes, 'NEVER-LOSE-ME')
assert.equal(getSidebar().counts.completed,1)
// 无清单、无日期的顶层任务归入收件箱，不再污染「今天」。
assert.deepEqual(
  listTasks({ view: 'inbox' }).map((t) => t.id),
  [c.id]
)
assert.ok(!listTasks({ view: 'today' }).some((t) => t.id === c.id))
// 清单内无日期任务不属于收件箱，也不会出现在今天。
assert.ok(!listTasks({ view: 'inbox' }).some((t) => t.id === listOnly.id))
assert.ok(!listTasks({ view: 'today' }).some((t) => t.id === listOnly.id))
assert.ok(listTasks({ view: 'list', listId: list.id }).some((t) => t.id === listOnly.id))
assert.equal(getSidebar().counts.inbox, 1)
assert.ok(listTasks({ view: 'someday' }).some((t) => t.id === maybe.id))
assert.ok(!listTasks({ view: 'today' }).some((t) => t.id === maybe.id))
assert.ok(!listTasks({ view: 'inbox' }).some((t) => t.id === maybe.id))
assert.ok(!listTasks({ view: 'inbox' }).some((t) => t.id === child.id))
assert.equal(getSidebar().counts.someday,1)
updateTask(maybe.id, { scheduledDate: today })
assert.equal(getTask(maybe.id)?.someday, false)
assert.ok(listTasks({ view: 'today' }).some((t) => t.id === maybe.id))
assert.ok(!listTasks({ view: 'someday' }).some((t) => t.id === maybe.id))
// 收件箱任务安排到今天后：离开收件箱、进入今天，计数同步。
updateTask(c.id, { scheduledDate: today })
assert.ok(!listTasks({ view: 'inbox' }).some((t) => t.id === c.id))
assert.ok(listTasks({ view: 'today' }).some((t) => t.id === c.id))
assert.equal(getSidebar().counts.inbox, 0)
console.log('OK 数据库断言通过')
