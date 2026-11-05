/**
 * FTS5 搜索回归：1500 条中英文混合任务 + 删除/完成/标签，覆盖
 * 3+ 字中文 FTS、2 字中文 LIKE 兜底、英文、标签、回收站过滤、分页、
 * 索引回填与 task_tags 同步。
 *
 * 运行：node --experimental-strip-types scripts/test-search.ts
 */
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  closeDb,
  createTag,
  createTask,
  deleteTag,
  deleteTask,
  getDataDir,
  initDb,
  searchTasks,
  setTaskStatus,
  transaction,
  updateTag,
  updateTask
} from '../src/main/db.ts'
import type { Task } from '../src/shared/types.ts'

const dir = join(process.cwd(), '.tmp', 'qa', 'search')
rmSync(dir, { recursive: true, force: true })
initDb(dir)

const dbPath = (): string => join(getDataDir(), 'lighttodo.db')

/** 逐页取完某个查询的全部结果（用于精确比对集合）。 */
function searchAll(term: string, pageSize = 500): Task[] {
  const all: Task[] = []
  let offset = 0
  for (;;) {
    const page = searchTasks(term, pageSize, offset)
    all.push(...page)
    if (page.length < pageSize) break
    offset += pageSize
    assert.ok(offset <= 20000, 'searchAll 未收敛')
  }
  return all
}

const allIds: string[] = []
const projectIds: string[] = []
const englishIds: string[] = []
const meetingIds: string[] = []
const deletedIds = new Set<string>()

transaction(() => {
  for (let i = 0; i < 1500; i += 1) {
    const kind = i % 5
    let task: Task
    if (kind === 0) {
      task = createTask({
        title: `项目进度周报 ${i}`,
        notes: `会议纪要 第${i}期 记录`,
        tagNames: ['工作汇报']
      })
      projectIds.push(task.id)
    } else if (kind === 1) {
      task = createTask({
        title: `会议纪要复盘 ${i}`,
        notes: `开会的结论与行动项 ${i}`,
        tagNames: ['紧急']
      })
      meetingIds.push(task.id)
    } else if (kind === 2) {
      task = createTask({
        title: `Quarterly planning review ${i}`,
        notes: `meeting notes for sprint ${i}`,
        tagNames: ['deepwork']
      })
      englishIds.push(task.id)
    } else if (kind === 3) {
      task = createTask({
        title: `日常杂务清单 ${i}`,
        notes: `整理文件与归档 ${i}`
      })
    } else {
      task = createTask({
        title: `项目进度跟踪 ${i}`,
        notes: `english keyword roadmap ${i}`,
        tagNames: ['工作汇报', 'deepwork']
      })
      projectIds.push(task.id)
    }
    allIds.push(task.id)
  }
  for (const [i, id] of allIds.entries()) {
    if (i % 6 === 0) setTaskStatus(id, true)
    if (i % 7 === 0) {
      deleteTask(id)
      deletedIds.add(id)
    }
  }
})

// 1) 3+ 字中文走 FTS，结果集合与“未删除的匹配任务”完全一致。
const expectedProject = new Set(projectIds.filter((id) => !deletedIds.has(id)))
const projectHits = searchAll('项目进度')
assert.deepEqual(new Set(projectHits.map((t) => t.id)), expectedProject)
assert.equal(searchTasks('项目进度').length, 200, '默认 limit 应为 200')
assert.ok(projectHits.some((t) => t.title.includes('项目进度')))
assert.ok(projectHits.some((t) => t.status === 1), '已完成任务也应能被搜索到')
const minutesHits = searchAll('会议纪要')
assert.ok(minutesHits.some((t) => t.id === meetingIds[0]))
assert.ok(minutesHits.every((t) => t.title.includes('会议纪要') || t.notes.includes('会议纪要')))
console.log('PASS 3+ 字中文 FTS 命中（项目进度 / 会议纪要）')

// 2) 少于 3 字的中文必须走 LIKE 兜底。
const kaihui = createTask({ title: '开会讨论季度方案', notes: '线下会议' })
const kaihui2 = createTask({ title: '临时开会同步进度' })
const kaihuiDeleted = createTask({ title: '开会已取消的任务' })
deleteTask(kaihuiDeleted.id)
deletedIds.add(kaihuiDeleted.id)
const twoCharHits = searchTasks('开会', 1000).map((t) => t.id)
assert.ok(twoCharHits.includes(kaihui.id), '开会被删前应命中')
assert.ok(twoCharHits.includes(kaihui2.id))
assert.ok(!twoCharHits.includes(kaihuiDeleted.id), '回收站任务不能被 LIKE 搜索命中')
assert.ok(searchTasks('会议', 1000).some((t) => t.id === meetingIds[0]))
console.log('PASS 2 字中文走 LIKE 兜底（开会）')

// 3) 英文 3+ 字命中标题与备注。
const englishHits = searchTasks('meeting', 1000)
assert.ok(englishHits.some((t) => t.id === englishIds[0]))
assert.ok(englishHits.every((t) => /meeting/i.test(`${t.title} ${t.notes}`)))
assert.ok(searchTasks('planning', 1000).some((t) => t.id === englishIds[0]))
console.log('PASS 英文 3+ 字命中（meeting / planning）')

// 4) 标签名命中（FTS tags 列），且返回的任务确实带该标签。
const tagHits = searchTasks('工作汇报', 1000)
assert.ok(tagHits.some((t) => t.id === projectHits[0].id))
assert.ok(tagHits.length > 0)
assert.ok(tagHits.every((t) => t.tags.some((tag) => tag.name === '工作汇报')))
console.log('PASS 标签名命中（工作汇报）')

// 5) 已删除任务在 FTS 和 LIKE 两条路径都不返回。
const secret = createTask({ title: '绝密会议纪要 404', notes: '只应存在于回收站' })
deleteTask(secret.id)
deletedIds.add(secret.id)
assert.equal(searchTasks('绝密会议纪要').length, 0)
assert.equal(searchTasks('绝密').length, 0)
console.log('PASS 已删除任务不返回')

// 6) limit/offset 分页无重复；2 字 LIKE 路径同样稳定。
const pages = [0, 50, 100, 150].map((offset) => searchTasks('项目进度', 50, offset))
assert.ok(pages.every((page) => page.length === 50))
const pageIds = pages.flat().map((t) => t.id)
assert.equal(new Set(pageIds).size, 200, '分页结果不应重复')
const likePage1 = searchTasks('项目', 200)
const likePage2 = searchTasks('项目', 200, 200)
assert.equal(likePage1.length, 200)
assert.equal(likePage2.length, 200)
assert.equal(new Set([...likePage1, ...likePage2].map((t) => t.id)).size, 400)
console.log('PASS limit/offset 分页无重复（FTS + LIKE）')

// 7) 索引空时全量回填：清空 tasks_fts、塞一条孤儿索引，重开数据库后自动修复。
const backfillTask = createTask({ title: '回填专用历史任务', notes: 'backfill marker' })
assert.ok(searchTasks('回填专用历史任务').some((t) => t.id === backfillTask.id))
const raw = new DatabaseSync(dbPath())
raw.exec('DELETE FROM tasks_fts')
raw
  .prepare(
    `INSERT INTO tasks_fts (task_id, title, notes, tags)
     VALUES ('orphan-row', '孤儿索引行', '', '')`
  )
  .run()
raw.close()
closeDb()
initDb(dir)
assert.ok(searchTasks('回填专用历史任务').some((t) => t.id === backfillTask.id), '空索引应全量回填')
assert.ok(searchTasks('项目进度').length > 0)
const rawCheck = new DatabaseSync(dbPath(), { readOnly: true })
const orphanRow = rawCheck
  .prepare(`SELECT COUNT(*) AS c FROM tasks_fts WHERE task_id = 'orphan-row'`)
  .get() as { c: number }
const ftsRows = rawCheck.prepare('SELECT COUNT(*) AS c FROM tasks_fts').get() as { c: number }
const taskRows = rawCheck.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }
rawCheck.close()
assert.equal(Number(orphanRow.c), 0, '孤儿索引应被清理')
assert.equal(Number(ftsRows.c), Number(taskRows.c), '每个任务应恰好一行索引')
console.log('PASS 空索引全量回填 + 孤儿索引清理')

// 8) task_tags 变化（updateTask 重建标签）立即反映到搜索。
const tagSyncTask = createTask({ title: '标签同步专用任务', tagNames: ['旧标签alpha'] })
assert.ok(searchTasks('旧标签alpha').some((t) => t.id === tagSyncTask.id))
updateTask(tagSyncTask.id, { tagNames: ['新标签beta'] })
assert.ok(!searchTasks('旧标签alpha').some((t) => t.id === tagSyncTask.id))
assert.ok(searchTasks('新标签beta').some((t) => t.id === tagSyncTask.id))
console.log('PASS task_tags 更新后搜索同步')

// 9) 直接改 task_tags（触发器）与标签改名/删除也同步。
const gamma = createTag('触发标签gamma')
const rawTags = new DatabaseSync(dbPath())
rawTags.prepare('INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)').run(tagSyncTask.id, gamma.id)
rawTags.close()
assert.ok(searchTasks('触发标签gamma').some((t) => t.id === tagSyncTask.id))
updateTag(gamma.id, { name: '重命名标签delta' })
assert.ok(searchTasks('重命名标签delta').some((t) => t.id === tagSyncTask.id))
assert.ok(!searchTasks('触发标签gamma').some((t) => t.id === tagSyncTask.id))
deleteTag(gamma.id)
assert.ok(!searchTasks('重命名标签delta').some((t) => t.id === tagSyncTask.id))
console.log('PASS task_tags 触发器 + 标签改名/删除同步')

// 10) 空查询直接返回空数组，FTS 语法字符不会让搜索抛错。
assert.deepEqual(searchTasks('   '), [])
assert.doesNotThrow(() => searchTasks('" - OR *'))
console.log('PASS 空查询返回 [] / FTS 特殊字符不崩')

// 轻量性能采样：只打印，不做阈值断言（避免机器抖动导致误报）。
function sampleP50(run: () => unknown, runs = 20): number {
  run()
  const samples: number[] = []
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now()
    run()
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  return Math.round(samples[Math.floor(samples.length / 2)] * 100) / 100
}
console.log(
  `INFO 1500 条库搜索 P50：中文FTS ${sampleP50(() => searchTasks('项目进度'))}ms / ` +
    `英文FTS ${sampleP50(() => searchTasks('meeting'))}ms / ` +
    `2字LIKE ${sampleP50(() => searchTasks('开会'))}ms`
)

closeDb()
console.log('OK 搜索断言全部通过（1500 条任务）')
