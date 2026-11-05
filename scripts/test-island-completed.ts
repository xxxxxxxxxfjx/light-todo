import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { closeDb, createTask, initDb, listCompletedBetween } from '../src/main/db.ts'

const dir = join(process.cwd(), '.tmp', 'qa', 'island-completed')
rmSync(dir, { recursive: true, force: true })
initDb(dir)

const today = '2026-11-05'
const [year, month, date] = today.split('-').map(Number)
const from = new Date(year, month - 1, date).toISOString()
const to = new Date(year, month - 1, date + 1).toISOString()

const atLocal = (offsetDays: number, hour: number, minute = 0): string => {
  const value = new Date(year, month - 1, date + offsetDays, hour, minute, 0, 0)
  return value.toISOString()
}

const early = createTask({ title: '凌晨完成' })
const noon = createTask({ title: '中午完成' })
const late = createTask({ title: '深夜完成' })
const yesterday = createTask({ title: '昨天完成' })
const tomorrow = createTask({ title: '明天完成' })
const parent = createTask({ title: '父任务' })
const child = createTask({ title: '子任务完成', parentId: parent.id })
const deleted = createTask({ title: '删除的完成' })
const active = createTask({ title: '未完成' })

const raw = new DatabaseSync(join(dir, 'lighttodo.db'))
const complete = raw.prepare('UPDATE tasks SET status = 1, completed_at = ? WHERE id = ?')
complete.run(atLocal(0, 0, 30), early.id)
complete.run(atLocal(0, 12), noon.id)
complete.run(atLocal(0, 23, 30), late.id)
complete.run(atLocal(-1, 23, 30), yesterday.id)
complete.run(atLocal(1, 0, 10), tomorrow.id)
complete.run(atLocal(0, 10), child.id)
complete.run(atLocal(0, 11), deleted.id)
raw.prepare('UPDATE tasks SET deleted_at = ? WHERE id = ?').run(atLocal(0, 12), deleted.id)
raw.close()

const sameDay = listCompletedBetween(from, to)
assert.deepEqual(
  sameDay.map((task) => task.title).sort(),
  ['中午完成', '凌晨完成', '深夜完成'],
  '只返回本地当天、顶层、未删除、已完成的任务'
)

// 分页不重不漏：3 条完成记录，每页 2 条。
const paged: string[] = []
for (let offset = 0; ; offset += 2) {
  const page = listCompletedBetween(from, to, 2, offset)
  paged.push(...page.map((task) => task.title))
  if (page.length < 2) break
}
assert.deepEqual(paged.sort(), ['中午完成', '凌晨完成', '深夜完成'].sort())

// 索引存在，供大数据量历史库走范围查询。
const check = new DatabaseSync(join(dir, 'lighttodo.db'))
const indexes = (check.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>)
  .map((row) => row.name)
check.close()
assert.ok(indexes.includes('idx_tasks_completed'))

assert.equal(active.status, 0)
closeDb()
console.log('PASS 任务岛今日完成按本地边界查询（排除子任务/删除/跨天）')
console.log('PASS 今日完成分页与 completed_at 索引')
