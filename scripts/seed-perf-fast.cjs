const { DatabaseSync } = require('node:sqlite')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')

const dir = require('node:path').join(process.cwd(), '.tmp', 'qa', 'perf')
fs.rmSync(dir, { recursive: true, force: true })
fs.mkdirSync(dir, { recursive: true })

// init schema via the app db module is overkill; use same schema minimal
const db = new DatabaseSync(`${dir}/lighttodo.db`)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')
db.exec(`
CREATE TABLE IF NOT EXISTS folders(id TEXT PRIMARY KEY,name TEXT,sort_order REAL DEFAULT 0,created_at TEXT);
CREATE TABLE IF NOT EXISTS lists(id TEXT PRIMARY KEY,folder_id TEXT,name TEXT,color TEXT,icon TEXT,sort_order REAL DEFAULT 0,is_pinned INTEGER DEFAULT 0,archived_at TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,list_id TEXT,parent_id TEXT,title TEXT,notes TEXT DEFAULT '',priority INTEGER DEFAULT 0,status INTEGER DEFAULT 0,scheduled_date TEXT,due_at TEXT,due_all_day INTEGER DEFAULT 0,rrule TEXT,repeat_from TEXT,reminder_at TEXT,reminder_offset INTEGER,notified_at TEXT,completed_at TEXT,deleted_at TEXT,sort_order REAL DEFAULT 0,created_at TEXT,updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_tasks_list ON tasks(list_id,status,deleted_at);
CREATE INDEX IF NOT EXISTS idx_tasks_sched ON tasks(scheduled_date,status);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_at,status);
CREATE TABLE IF NOT EXISTS tags(id TEXT PRIMARY KEY,name TEXT UNIQUE,color TEXT);
CREATE TABLE IF NOT EXISTS task_tags(task_id TEXT,tag_id TEXT,PRIMARY KEY(task_id,tag_id));
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
`)

const lists = ['工作', '生活', '学习', '项目A', '项目B']
const listIds = lists.map(() => randomUUID())
const insertList = db.prepare('INSERT INTO lists(id,name,color,sort_order,created_at) VALUES (?,?,?,?,?)')
lists.forEach((name, i) => insertList.run(listIds[i], name, '#0f6cbd', i * 1024, new Date().toISOString()))

const insert = db.prepare(`INSERT INTO tasks (id,list_id,parent_id,title,notes,priority,status,scheduled_date,due_at,due_all_day,rrule,repeat_from,reminder_at,reminder_offset,notified_at,completed_at,deleted_at,sort_order,created_at,updated_at)
VALUES (?,?,?,?,?,?,0,?,?,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,?,?,?)`)

const N = 10000
const t0 = Date.now()
db.exec('BEGIN')
for (let i = 0; i < N; i++) {
  const day = (i % 14) - 2
  const d = new Date()
  d.setDate(d.getDate() + day)
  const sd = i % 3 === 0 ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null
  insert.run(
    randomUUID(),
    listIds[i % listIds.length],
    null,
    `任务 ${i + 1}：${lists[i % lists.length]} 的事项`,
    i % 5 === 0 ? '这是一条备注，包含一些正文内容用于全文检索。' : '',
    i % 10 === 0 ? 3 : i % 4 === 0 ? 2 : i % 3 === 0 ? 1 : 0,
    sd,
    null,
    i * 1024,
    new Date().toISOString(),
    new Date().toISOString()
  )
}
db.exec('COMMIT')
console.log('inserted', N, `${Date.now() - t0}ms`)
console.log('count', db.prepare('SELECT COUNT(*) c FROM tasks').get().c)
