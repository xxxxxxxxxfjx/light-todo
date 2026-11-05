#!/usr/bin/env node
/**
 * Rebuild an isolated LightTodo database for performance work.
 *
 * Usage (from the repository root):
 *   node --experimental-strip-types scripts/seed-bench-10k.ts
 *   node --experimental-strip-types scripts/seed-bench-10k.ts --dir .perf-bench --count 10000
 *
 * The target directory must be inside this repository. It is deleted and
 * recreated on every run. The schema comes from src/main/db.ts (initDb), then
 * rows are written in one transaction with deterministic ids so datasets are
 * diffable and repeatable.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, rmSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { closeDb, initDb } from '../src/main/db.ts'

const ROOT = resolve(process.cwd())

function fail(message: string): never {
  console.error(`seed-bench-10k: ${message}`)
  process.exit(1)
}

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  if (index < 0) return fallback
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) fail(`--${name} requires a value`)
  return value
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Usage: node --experimental-strip-types scripts/seed-bench-10k.ts [options]

  --dir <path>    data directory inside the repository (default: .perf-bench)
  --count <n>     total number of tasks (default: 10000, minimum: 10)
  --help          show this help`)
  process.exit(0)
}

const countRaw = argValue('count', '10000')
const count = Number(countRaw)
if (!Number.isInteger(count) || count < 10 || count > 500000) {
  fail(`--count must be an integer between 10 and 500000 (received ${countRaw})`)
}

const dir = resolve(ROOT, argValue('dir', '.perf-bench'))
const rel = relative(ROOT, dir)
if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
  fail('--dir must be a non-root directory inside the repository workspace')
}
if (dir === ROOT) fail('refusing to clear the repository root')
const protectedTopLevel = new Set([
  '.git',
  'src',
  'scripts',
  'docs',
  'out',
  'dist',
  'build',
  'release',
  'node_modules'
])
const firstSegment = rel.split(/[\\/]/)[0]
if (protectedTopLevel.has(firstSegment)) {
  fail(`refusing to clear protected project directory: ${rel}`)
}

const DATABASE = join(dir, 'lighttodo.db')
const lists = [
  { id: 'bench-list-work', name: '工作', color: '#0f6cbd', icon: '💼' },
  { id: 'bench-list-life', name: '生活', color: '#3a9a5b', icon: '🌿' },
  { id: 'bench-list-study', name: '学习', color: '#8764b8', icon: '📚' },
  { id: 'bench-list-project-a', name: '项目 A', color: '#c9771f', icon: '🚀' },
  { id: 'bench-list-project-b', name: '项目 B', color: '#c42b1c', icon: '🧪' }
]
const tags = [
  { id: 'bench-tag-urgent', name: '紧急', color: '#d13438' },
  { id: 'bench-tag-meeting', name: '会议', color: '#0f6cbd' },
  { id: 'bench-tag-reading', name: '阅读', color: '#8764b8' },
  { id: 'bench-tag-waiting', name: '等待', color: '#c9771f' },
  { id: 'bench-tag-design', name: '设计', color: '#3a9a5b' },
  { id: 'bench-tag-meeting-en', name: 'meeting', color: '#5c5c67' },
  { id: 'bench-tag-urgent-en', name: 'urgent', color: '#8b8b96' }
]

type Category = 'overdue' | 'today' | 'future' | 'nodate' | 'someday' | 'completed' | 'trash'
interface CategoryPlan {
  category: Category
  total: number
}

function localDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}

function isoAt(date: Date, hour: number, minute = 0): string {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hour,
    minute,
    0,
    0
  ).toISOString()
}

/** Deterministic PRNG so category order is mixed but reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function categoryPlan(total: number): CategoryPlan[] {
  // At least one completed and one trashed task for small smoke datasets.
  const someday = Math.floor(total * 0.08)
  const completed = Math.max(1, Math.floor(total * 0.01))
  const trash = Math.max(1, Math.floor(total * 0.01))
  const active = total - someday - completed - trash
  if (active < 4) fail('--count is too small to cover all requested task states')
  const overdue = Math.floor((active * 15) / 90)
  const today = Math.floor((active * 20) / 90)
  const future = Math.floor((active * 25) / 90)
  const nodate = active - overdue - today - future
  return [
    { category: 'overdue', total: overdue },
    { category: 'today', total: today },
    { category: 'future', total: future },
    { category: 'nodate', total: nodate },
    { category: 'someday', total: someday },
    { category: 'completed', total: completed },
    { category: 'trash', total: trash }
  ]
}

function mixedCategories(plan: CategoryPlan[]): Category[] {
  const result: Category[] = []
  for (const item of plan) {
    for (let i = 0; i < item.total; i += 1) result.push(item.category)
  }
  const random = mulberry32(0x1a2b3c4d)
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const tmp = result[i]
    result[i] = result[j]
    result[j] = tmp
  }
  return result
}

const plan = categoryPlan(count)
const categories = mixedCategories(plan)
if (categories.length !== count) fail('internal category distribution error')

const now = new Date()
const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
const nowIso = now.toISOString()

console.log(`Rebuilding ${dir}`)
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })

// Let the application's real schema create the database and indexes, then
// discard its demo seed rows before inserting the benchmark dataset.
initDb(dir)
closeDb()

const db = new DatabaseSync(DATABASE)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA synchronous = NORMAL')
db.exec('PRAGMA foreign_keys = ON')

const insertFolder = db.prepare(
  'INSERT INTO folders (id,name,sort_order,created_at) VALUES (?,?,?,?)'
)
const insertList = db.prepare(
  `INSERT INTO lists (id,folder_id,name,color,icon,sort_order,is_pinned,archived_at,created_at)
   VALUES (?,?,?,?,?,?,?,?,?)`
)
const insertTag = db.prepare('INSERT INTO tags (id,name,color) VALUES (?,?,?)')
const insertTask = db.prepare(
  `INSERT INTO tasks (
     id,list_id,parent_id,title,notes,priority,status,someday,
     scheduled_date,due_at,due_all_day,rrule,repeat_from,reminder_at,
     reminder_offset,notified_at,completed_at,deleted_at,deleted_batch,
     sort_order,created_at,updated_at
   ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
)
const insertTaskTag = db.prepare(
  'INSERT OR IGNORE INTO task_tags (task_id,tag_id) VALUES (?,?)'
)
const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)')

const started = performance.now()
const distribution: Record<Category | 'total', number> = {
  overdue: 0,
  today: 0,
  future: 0,
  nodate: 0,
  someday: 0,
  completed: 0,
  trash: 0,
  total: count
}
db.exec('BEGIN IMMEDIATE')
try {
  db.exec('DELETE FROM task_tags')
  db.exec('DELETE FROM tasks')
  db.exec('DELETE FROM tags')
  db.exec('DELETE FROM lists')
  db.exec('DELETE FROM folders')
  db.exec('DELETE FROM settings')

  insertFolder.run('bench-folder-active', '基准项目', 0, nowIso)
  lists.forEach((list, index) => {
    insertList.run(
      list.id,
      index < 3 ? 'bench-folder-active' : null,
      list.name,
      list.color,
      list.icon,
      index * 1024,
      index === 0 ? 1 : 0,
      null,
      nowIso
    )
  })
  for (const tag of tags) insertTag.run(tag.id, tag.name, tag.color)

  const longSuffix =
    ' — 这是一条用于测试超长标题截断、换行与布局稳定性的任务名称，' +
    '包含中文、English、数字 1234567890 和标点符号。' +
    'The quick brown fox jumps over the lazy dog. '.repeat(2)

  for (let i = 0; i < count; i += 1) {
    const category = categories[i]
    distribution[category] += 1
    const list = lists[i % lists.length]
    const id = `bench-task-${String(i + 1).padStart(6, '0')}`
    const createdAt = new Date(now.getTime() - (count - i) * 60000).toISOString()
    const offsetDays = (i % 30) + 1
    let scheduledDate: string | null = null
    let dueAt: string | null = null
    let dueAllDay = 0
    let status = 0
    let someday = 0
    let completedAt: string | null = null
    let deletedAt: string | null = null
    let deletedBatch: string | null = null

    if (category === 'overdue') {
      if (i % 4 === 0) dueAt = isoAt(addDays(todayStart, -offsetDays), 18, 30)
      else scheduledDate = localDate(addDays(todayStart, -offsetDays))
    } else if (category === 'today') {
      if (i % 4 === 0) dueAt = isoAt(todayStart, 17 + (i % 4), 15)
      else scheduledDate = localDate(todayStart)
      dueAllDay = scheduledDate ? 1 : 0
    } else if (category === 'future') {
      const day = addDays(todayStart, 1 + (i % 7))
      if (i % 5 === 0) dueAt = isoAt(day, 9 + (i % 8), 0)
      else scheduledDate = localDate(day)
      dueAllDay = scheduledDate ? 1 : 0
    } else if (category === 'someday') {
      someday = 1
    } else if (category === 'completed') {
      status = 1
      completedAt = new Date(now.getTime() - (i % 30) * 3600000).toISOString()
      scheduledDate = localDate(addDays(todayStart, -(i % 20)))
      dueAllDay = 1
    } else if (category === 'trash') {
      deletedAt = new Date(now.getTime() - (i % 20) * 3600000).toISOString()
      deletedBatch = 'bench-trash-batch'
      scheduledDate = localDate(addDays(todayStart, -(i % 20)))
      dueAllDay = 1
    }

    const title =
      i % 50 === 0
        ? `任务 ${String(i + 1).padStart(5, '0')} · ${list.name} · ${category}${longSuffix}`
        : `任务 ${String(i + 1).padStart(5, '0')} · ${list.name} · ${
            category === 'someday' ? '稍后再想' : category === 'completed' ? '已完成事项' : '事项'
          }`
    const notes =
      i % 3 === 0
        ? [
            '# 备注',
            '',
            `- 会议要点 meeting notes #${i + 1}`,
            `- 验收关键词：性能基准 / benchmark / ${list.name}`,
            '- 这里是一些用于搜索和详情面板渲染的正文。'
          ].join('\n')
        : i % 7 === 0
          ? `短备注 ${i + 1}：等待确认 urgent`
          : ''
    const priority = i % 7 === 0 ? 3 : i % 5 === 0 ? 2 : i % 3 === 0 ? 1 : 0
    const tagIds = i % 4 === 0
      ? [tags[i % tags.length].id, tags[(i + 2) % tags.length].id]
      : [tags[i % tags.length].id]

    insertTask.run(
      id,
      list.id,
      null,
      title,
      notes,
      priority,
      status,
      someday,
      scheduledDate,
      dueAt,
      dueAllDay,
      null,
      null,
      null,
      null,
      null,
      completedAt,
      deletedAt,
      deletedBatch,
      i * 1024,
      createdAt,
      createdAt
    )
    for (const tagId of new Set(tagIds)) insertTaskTag.run(id, tagId)
  }

  insertSetting.run('seeded', '1')
  db.exec('COMMIT')
} catch (error) {
  try {
    db.exec('ROLLBACK')
  } catch {
    /* transaction may already be closed */
  }
  db.close()
  throw error
}

db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
const elapsed = performance.now() - started

const totalRow = db.prepare('SELECT COUNT(*) AS total FROM tasks').get() as { total: number }
if (totalRow.total !== count) fail(`database has ${totalRow.total} tasks, expected ${count}`)
const fileSize = db.prepare('PRAGMA page_count').get() as { page_count: number }
const pageSize = db.prepare('PRAGMA page_size').get() as { page_size: number }
db.close()

console.log(
  JSON.stringify(
    {
      dir,
      database: DATABASE,
      tasks: totalRow.total,
      lists: lists.length,
      tags: tags.length,
      distribution,
      activeForAllView: count - distribution.completed - distribution.trash,
      databaseBytes: fileSize.page_count * pageSize.page_size,
      seedMs: Math.round(elapsed)
    },
    null,
    2
  )
)
