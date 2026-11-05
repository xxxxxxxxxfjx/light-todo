/**
 * 周复盘 SQL 口径回归：本地日期分组、7 天补零、逾期、清单归属与软删除排除。
 *
 * 运行：node --experimental-strip-types scripts/test-review.ts
 */
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { addDays, format, startOfDay } from 'date-fns'
import {
  closeDb,
  createList,
  createTask,
  deleteTask,
  getDataDir,
  getWeeklyReview,
  initDb
} from '../src/main/db.ts'

const dir = join(process.cwd(), '.tmp', 'qa', 'review')
rmSync(dir, { recursive: true, force: true })
initDb(dir)

// 清掉 initDb 的演示数据，避免默认任务干扰固定数据断言；保留 seeded=1，防止重开时再次播种。
closeDb()
const seedCleanup = new DatabaseSync(join(dir, 'lighttodo.db'))
seedCleanup.exec('DELETE FROM tasks; DELETE FROM lists; DELETE FROM tags; DELETE FROM folders;')
seedCleanup.close()
initDb(dir)

const now = new Date(2026, 10, 5, 12, 0, 0, 0)
const dbPath = (): string => join(getDataDir(), 'lighttodo.db')

function dayKey(offset: number): string {
  return format(addDays(startOfDay(now), offset), 'yyyy-MM-dd')
}

/** 构造本地时间再转 ISO UTC，覆盖“凌晨完成在 UTC 仍属前一天”的场景。 */
function localIso(offset: number, hours: number, minutes = 0): string {
  const date = addDays(startOfDay(now), offset)
  date.setHours(hours, minutes, 0, 0)
  return date.toISOString()
}

const work = createList({ name: '工作', color: '#0f6cbd' })
const life = createList({ name: '生活', color: '#3a9a5b' })
const archived = createList({ name: '归档清单', color: '#999999' })

const completedToday = createTask({ title: '今天凌晨完成', listId: work.id })
const completedYesterday = createTask({ title: '昨天完成', listId: work.id })
const overdueDue = createTask({
  title: '截止时间已过',
  listId: life.id,
  dueAt: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()
})
const overdueScheduled = createTask({
  title: '计划日在昨天',
  listId: life.id,
  scheduledDate: dayKey(-1)
})
const activeToday = createTask({
  title: '今天的待办',
  listId: work.id,
  scheduledDate: dayKey(0)
})
const activeSomeday = createTask({
  title: '也许以后',
  listId: archived.id,
  someday: true
})
const deletedCompleted = createTask({ title: '删除后不计入', listId: null })
const completedOutside = createTask({ title: '七天之外完成', listId: work.id })
const activeTomorrow = createTask({
  title: '明天待办',
  listId: life.id,
  scheduledDate: dayKey(1)
})
// 子任务只属于父任务：周复盘统一按顶层任务统计，下面三条用于锁定口径。
const activeChild = createTask({ title: '进行中子任务', parentId: activeToday.id, listId: work.id })
const activeChild2 = createTask({ title: '另一个子任务', parentId: activeTomorrow.id, listId: life.id })
const doneChild = createTask({ title: '已完成子任务', parentId: completedToday.id, listId: work.id })

const raw = new DatabaseSync(dbPath())
const setCreated = raw.prepare('UPDATE tasks SET created_at = ? WHERE id = ?')
const setCompleted = raw.prepare(
  'UPDATE tasks SET status = 1, completed_at = ? WHERE id = ?'
)

setCreated.run(localIso(-6, 8), completedToday.id)
setCompleted.run(localIso(0, 0, 30), completedToday.id)

setCreated.run(localIso(-5, 10, 15), completedYesterday.id)
setCompleted.run(localIso(-1, 23, 45), completedYesterday.id)

setCreated.run(localIso(0, 9), overdueDue.id)
setCreated.run(localIso(-2, 7, 30), overdueScheduled.id)
setCreated.run(localIso(0, 8, 10), activeToday.id)
setCreated.run(localIso(-3, 21), activeSomeday.id)
setCreated.run(localIso(0, 10), deletedCompleted.id)
setCompleted.run(localIso(0, 11), deletedCompleted.id)
setCreated.run(localIso(-8, 9), completedOutside.id)
setCompleted.run(localIso(-8, 12), completedOutside.id)
setCreated.run(localIso(-1, 18, 45), activeTomorrow.id)
setCreated.run(localIso(0, 9, 5), activeChild.id)
setCreated.run(localIso(0, 9, 6), activeChild2.id)
setCreated.run(localIso(0, 9, 7), doneChild.id)
setCompleted.run(localIso(0, 9, 30), doneChild.id)
// 归档清单不属于当前清单导航，其任务应进入“未分类”分布。
raw.prepare('UPDATE lists SET archived_at = ? WHERE id = ?').run(localIso(0, 12), archived.id)
raw.close()

deleteTask(deletedCompleted.id)

const review = getWeeklyReview(now)

// 1) 固定 7 天，从旧到新，最后一天是本地今天。
assert.equal(review.days.length, 7)
assert.deepEqual(
  review.days.map((day) => day.date),
  Array.from({ length: 7 }, (_, index) => dayKey(index - 6))
)
assert.equal(review.days[6].date, '2026-11-05')
console.log('PASS 7 天日期数组长度 / 顺序 / 本地今天')

// 2) 本地日期分组：在 UTC+8 下 completedToday 的 ISO 是 UTC 11-04，但本地是 11-05。
assert.deepEqual(
  review.days.map((day) => day.completed),
  [0, 0, 0, 0, 0, 1, 1],
  '完成数应按本地日期分组，且删除/七天外任务不计'
)
assert.deepEqual(
  review.days.map((day) => day.created),
  [1, 1, 0, 1, 1, 1, 2],
  '新增数应按本地日期分组，且删除任务不计'
)
console.log('PASS 按 date(..., \'localtime\') 分组并补齐 0')

// 2.1 13 周热力图：按周一对齐、最后一天是今天，完成总数与复盘一致。
assert.ok(review.heatmap.length >= 91, `热力图至少 91 天，实际 ${review.heatmap.length}`)
assert.equal(review.heatmap.at(-1)?.date, '2026-11-05')
assert.equal(review.heatmap.slice(-7).reduce((sum, day) => sum + day.completed, 0), review.completed, '热力图最后 7 天应与周复盘完成数一致')
assert.equal(review.heatmap.find((day) => day.date === '2026-11-05')?.completed, 1)
assert.equal(new Date(`${review.heatmap[0].date}T00:00:00`).getDay(), 1, '热力图应从周一开始')
console.log('PASS 13 周完成热力图（周一对齐、最后一天为今天）')

// 3) 顶部指标。
assert.equal(review.completed, 2, '最近 7 天完成应为 2')
assert.equal(review.created, 7, '最近 7 天新增应为 7')
assert.equal(review.overdue, 2, '当前逾期应为 2（截止时间已过 + 计划日已过）')
assert.equal(review.active, 5, '当前待办应为 5')
assert.equal(
  review.days.reduce((sum, day) => sum + day.completed, 0),
  review.completed
)
assert.equal(review.days.reduce((sum, day) => sum + day.created, 0), review.created)
console.log('PASS completed / created / overdue / active 汇总（仅顶层任务）')

// 4) 清单分布、未知 listId -> 未分类、归档清单排除、按完成数降序。
const workStats = review.lists.find((list) => list.id === work.id)
const lifeStats = review.lists.find((list) => list.id === life.id)
const unclassified = review.lists.find((list) => list.id === '')
assert.deepEqual(workStats, {
  id: work.id,
  name: '工作',
  color: '#0f6cbd',
  completed: 2,
  active: 1
})
assert.deepEqual(lifeStats, {
  id: life.id,
  name: '生活',
  color: '#3a9a5b',
  completed: 0,
  active: 3
})
assert.deepEqual(unclassified, {
  id: '',
  name: '未分类',
  color: null,
  completed: 0,
  active: 1
})
assert.equal(review.lists[0].id, work.id, '清单应按最近 7 天完成数降序')
assert.ok(!review.lists.some((list) => list.id === archived.id), '归档清单不应出现')
assert.ok(
  review.lists.every((list, index, all) => index === 0 || all[index - 1].completed >= list.completed),
  '清单完成数必须降序'
)
console.log('PASS 清单 completed / active、未分类与归档排除')

closeDb()
console.log('OK 周复盘断言全部通过')
