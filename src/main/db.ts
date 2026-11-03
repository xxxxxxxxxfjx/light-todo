import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { addDays, format, startOfDay } from 'date-fns'
import rrulePkg from 'rrule'

const { RRule } = rrulePkg
import type {
  CreateTaskInput,
  Folder,
  List,
  SidebarData,
  Tag,
  Task,
  UpdateTaskInput,
  ViewKey
} from '../shared/types'

let db: DatabaseSync | null = null
let dataDirPath = ''

const SCHEMA = `
CREATE TABLE IF NOT EXISTS folders (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  sort_order  REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lists (
  id          TEXT PRIMARY KEY,
  folder_id   TEXT REFERENCES folders(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  color       TEXT,
  icon        TEXT,
  sort_order  REAL NOT NULL DEFAULT 0,
  is_pinned   INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id             TEXT PRIMARY KEY,
  list_id        TEXT REFERENCES lists(id) ON DELETE CASCADE,
  parent_id      TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  notes          TEXT NOT NULL DEFAULT '',
  priority       INTEGER NOT NULL DEFAULT 0,
  status         INTEGER NOT NULL DEFAULT 0,
  scheduled_date TEXT,
  due_at         TEXT,
  due_all_day    INTEGER NOT NULL DEFAULT 0,
  rrule          TEXT,
  repeat_from    TEXT,
  reminder_at    TEXT,
  reminder_offset INTEGER,
  notified_at    TEXT,
  completed_at   TEXT,
  deleted_at     TEXT,
  sort_order     REAL NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_list     ON tasks(list_id, status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_tasks_sched    ON tasks(scheduled_date, status);
CREATE INDEX IF NOT EXISTS idx_tasks_due      ON tasks(due_at, status);
CREATE INDEX IF NOT EXISTS idx_tasks_parent   ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_reminder ON tasks(reminder_at);

CREATE TABLE IF NOT EXISTS tags (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  color TEXT
);

CREATE TABLE IF NOT EXISTS task_tags (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

const TAGS_SUBQUERY = `(
  SELECT json_group_array(json_object('id', tg.id, 'name', tg.name, 'color', tg.color))
  FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id
  WHERE tt.task_id = t.id
) AS tags_json`

const SUBTASK_COUNTS = `(
  SELECT COUNT(*) FROM tasks c WHERE c.parent_id = t.id AND c.deleted_at IS NULL
) AS subtask_count,
(
  SELECT COUNT(*) FROM tasks c WHERE c.parent_id = t.id AND c.status = 1 AND c.deleted_at IS NULL
) AS subtask_done`

function conn(): DatabaseSync {
  if (!db) throw new Error('Database not initialized')
  return db
}

export function getDataDir(): string {
  return dataDirPath
}

export function initDb(dir: string): void {
  dataDirPath = dir
  mkdirSync(dir, { recursive: true })
  db = new DatabaseSync(join(dir, 'lighttodo.db'))
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA)
  ensureColumn('tasks', 'reminder_offset', 'INTEGER')
  ensureColumn('tasks', 'notified_at', 'TEXT')
  seedIfEmpty()
}

export function closeDb(): void {
  try {
    db?.close()
  } catch {
    /* ignore */
  }
  db = null
}

function nowIso(): string {
  return new Date().toISOString()
}

function ensureColumn(table: string, column: string, type: string): void {
  const cols = conn().prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === column)) {
    conn().exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  }
}

function reminderTime(
  dueAt: string | null,
  scheduledDate: string | null,
  offsetMinutes: number | null
): string | null {
  if (offsetMinutes === null) return null
  let base: Date | null = null
  if (dueAt) {
    base = new Date(dueAt)
  } else if (scheduledDate) {
    const [y, mo, d] = scheduledDate.split('-').map(Number)
    base = new Date(y, (mo ?? 1) - 1, d ?? 1, 9, 0, 0, 0)
  }
  if (!base || isNaN(base.getTime())) return null
  return new Date(base.getTime() - offsetMinutes * 60000).toISOString()
}

function dayStr(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

function seedIfEmpty(): void {
  const row = conn().prepare('SELECT COUNT(*) AS c FROM lists').get() as { c: number }
  if (row.c > 0) return

  const folderId = randomUUID()
  const workId = randomUUID()
  const lifeId = randomUUID()
  const now = nowIso()
  const today = dayStr(new Date())

  conn().prepare('INSERT INTO folders (id,name,sort_order,created_at) VALUES (?,?,?,?)').run(
    folderId,
    '工作',
    0,
    now
  )
  const insertList = conn().prepare(
    'INSERT INTO lists (id,folder_id,name,color,icon,sort_order,created_at) VALUES (?,?,?,?,?,?,?)'
  )
  insertList.run(workId, folderId, '工作', '#0f6cbd', '💼', 0, now)
  insertList.run(lifeId, null, '生活', '#3a9a5b', '🌿', 1024, now)

  const tagUrgent = randomUUID()
  const tagReport = randomUUID()
  conn().prepare('INSERT INTO tags (id,name,color) VALUES (?,?,?)').run(tagUrgent, '紧急', '#d13438')
  conn().prepare('INSERT INTO tags (id,name,color) VALUES (?,?,?)').run(tagReport, '汇报', '#8764b8')

  const welcome = createTask({
    title: '欢迎使用轻单 👋',
    notes:
      '这是一个本地优先的待办应用：\n\n- 按 **Ctrl+Shift+Space** 随时记下想法\n- 在左侧创建清单，用 `#清单` 和 `@标签` 快速归类\n- 所有数据都保存在你自己的电脑上',
    listId: null,
    scheduledDate: today,
    priority: 1
  })
  const syntax = createTask({
    title: '试试一句话添加任务',
    notes: '在输入框里试试：\n\n明天下午3点 交周报 #工作 @汇报 !高\n\n日期、时间、重复、清单、标签、优先级会被自动识别。',
    listId: null,
    scheduledDate: today,
    priority: 2
  })
  const first = createTask({
    title: '在左侧「工作」清单里添加第一条真实任务',
    listId: workId,
    scheduledDate: today,
    priority: 0
  })
  reorderTasks([
    { id: welcome.id, sortOrder: 1024 },
    { id: syntax.id, sortOrder: 2048 },
    { id: first.id, sortOrder: 3072 }
  ])
  conn()
    .prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?,?)')
    .run(syntax.id, tagReport)
}

function mapTask(r: Record<string, unknown>): Task {
  return {
    id: r.id as string,
    listId: (r.list_id as string) ?? null,
    parentId: (r.parent_id as string) ?? null,
    title: r.title as string,
    notes: (r.notes as string) ?? '',
    priority: Number(r.priority ?? 0),
    status: Number(r.status ?? 0),
    scheduledDate: (r.scheduled_date as string) ?? null,
    dueAt: (r.due_at as string) ?? null,
    dueAllDay: Number(r.due_all_day ?? 0),
    rrule: (r.rrule as string) ?? null,
    repeatFrom: (r.repeat_from as Task['repeatFrom']) ?? null,
    reminderAt: (r.reminder_at as string) ?? null,
    reminderOffset:
      r.reminder_offset === null || r.reminder_offset === undefined
        ? null
        : Number(r.reminder_offset),
    notifiedAt: (r.notified_at as string) ?? null,
    completedAt: (r.completed_at as string) ?? null,
    deletedAt: (r.deleted_at as string) ?? null,
    sortOrder: Number(r.sort_order ?? 0),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    tags: r.tags_json ? (JSON.parse(r.tags_json as string) as Tag[]) : [],
    subtaskCount: Number(r.subtask_count ?? 0),
    subtaskDone: Number(r.subtask_done ?? 0)
  }
}

export function listTasks(opts: {
  view: ViewKey
  listId?: string
  tagId?: string
  limit?: number
}): Task[] {
  const now = new Date()
  const today = dayStr(now)
  const tomorrow = dayStr(addDays(now, 1))
  const in7 = dayStr(addDays(now, 7))
  const tomorrowStart = startOfDay(addDays(now, 1)).toISOString()
  const in8Start = startOfDay(addDays(now, 8)).toISOString()

  let where = 't.deleted_at IS NULL AND t.parent_id IS NULL'
  const params: unknown[] = []
  let order = 't.sort_order ASC, t.created_at DESC'
  let limit = opts.limit ?? 1000

  switch (opts.view) {
    case 'inbox':
      where += ' AND t.status = 0 AND t.list_id IS NULL'
      break
    case 'today':
      where +=
        ' AND t.status = 0 AND ((t.scheduled_date IS NOT NULL AND t.scheduled_date <= ?) OR (t.due_at IS NOT NULL AND t.due_at < ?))'
      params.push(today, tomorrowStart)
      order = `CASE WHEN (t.due_at IS NOT NULL AND t.due_at < '${now.toISOString()}') OR (t.scheduled_date IS NOT NULL AND t.scheduled_date < '${today}') THEN 0 ELSE 1 END, t.sort_order ASC, t.created_at DESC`
      break
    case 'upcoming':
      where +=
        ' AND t.status = 0 AND ((t.scheduled_date IS NOT NULL AND t.scheduled_date > ? AND t.scheduled_date <= ?) OR (t.due_at IS NOT NULL AND t.due_at >= ? AND t.due_at < ?))'
      params.push(today, in7, tomorrowStart, in8Start)
      break
    case 'all':
      where += ' AND t.status = 0'
      break
    case 'someday':
      where += ' AND t.status = 0 AND t.scheduled_date IS NULL AND t.due_at IS NULL'
      break
    case 'completed':
      where += ' AND t.status = 1'
      order = 't.completed_at DESC'
      limit = opts.limit ?? 300
      break
    case 'trash':
      where = 't.deleted_at IS NOT NULL AND t.parent_id IS NULL'
      order = 't.deleted_at DESC'
      limit = opts.limit ?? 300
      break
    case 'calendar':
      where += ' AND t.status = 0'
      break
    case 'list':
      where += ' AND t.status = 0 AND t.list_id = ?'
      params.push(opts.listId ?? '')
      break
    case 'tag':
      where +=
        ' AND t.status = 0 AND t.id IN (SELECT task_id FROM task_tags WHERE tag_id = ?)'
      params.push(opts.tagId ?? '')
      break
  }

  const sql = `SELECT t.*, ${TAGS_SUBQUERY}, ${SUBTASK_COUNTS}
    FROM tasks t WHERE ${where} ORDER BY ${order} LIMIT ?`
  params.push(limit)
  const rows = conn().prepare(sql).all(...(params as never[])) as Record<string, unknown>[]
  return rows.map(mapTask)
}

export function getTask(id: string): Task | null {
  const row = conn()
    .prepare(
      `SELECT t.*, ${TAGS_SUBQUERY}, ${SUBTASK_COUNTS} FROM tasks t WHERE t.id = ? AND t.deleted_at IS NULL`
    )
    .get(id) as Record<string, unknown> | undefined
  if (!row) return null
  const task = mapTask(row)
  const children = conn()
    .prepare(
      `SELECT t.*, ${TAGS_SUBQUERY}, ${SUBTASK_COUNTS} FROM tasks t
       WHERE t.parent_id = ? AND t.deleted_at IS NULL ORDER BY t.sort_order ASC, t.created_at ASC`
    )
    .all(id) as Record<string, unknown>[]
  task.subtasks = children.map(mapTask)
  return task
}

function nextSortOrder(listId: string | null, parentId: string | null): number {
  const row = conn()
    .prepare(
      `SELECT MAX(sort_order) AS m FROM tasks WHERE deleted_at IS NULL
       AND ((list_id IS ? AND parent_id IS ?))`
    )
    .get(listId, parentId) as { m: number | null }
  return (row.m ?? 0) + 1024
}

function ensureTags(names: string[]): string[] {
  const ids: string[] = []
  for (const raw of names) {
    const name = raw.trim().replace(/^@/, '')
    if (!name) continue
    const found = conn().prepare('SELECT id FROM tags WHERE name = ?').get(name) as
      | { id: string }
      | undefined
    if (found) {
      ids.push(found.id)
    } else {
      const id = randomUUID()
      conn().prepare('INSERT INTO tags (id,name,color) VALUES (?,?,NULL)').run(id, name)
      ids.push(id)
    }
  }
  return ids
}

export function createTask(input: CreateTaskInput): Task {
  const id = randomUUID()
  const now = nowIso()
  let listId = input.listId ?? null
  if (input.parentId) {
    const parent = conn().prepare('SELECT list_id FROM tasks WHERE id = ?').get(input.parentId) as
      | { list_id: string | null }
      | undefined
    if (parent) listId = parent.list_id
  }
  const offset = input.reminderOffset ?? null
  const reminderAt =
    input.reminderAt ??
    reminderTime(input.dueAt ?? null, input.scheduledDate ?? null, offset)
  conn()
    .prepare(
      `INSERT INTO tasks (id,list_id,parent_id,title,notes,priority,status,scheduled_date,due_at,due_all_day,rrule,repeat_from,reminder_at,reminder_offset,notified_at,created_at,updated_at,sort_order)
       VALUES (?,?,?,?,?,?,0,?,?,?,?,?,?,?,NULL,?,?,?)`
    )
    .run(
      id,
      listId,
      input.parentId ?? null,
      input.title.trim(),
      input.notes ?? '',
      input.priority ?? 0,
      input.scheduledDate ?? null,
      input.dueAt ?? null,
      input.dueAllDay ?? 0,
      input.rrule ?? null,
      input.repeatFrom ?? null,
      reminderAt,
      offset,
      now,
      now,
      nextSortOrder(listId, input.parentId ?? null)
    )
  if (input.tagNames?.length) {
    const tagIds = ensureTags(input.tagNames)
    const stmt = conn().prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?,?)')
    for (const tid of tagIds) stmt.run(id, tid)
  }
  return getTask(id)!
}

export function updateTask(id: string, patch: UpdateTaskInput): Task {
  const fields: string[] = []
  const params: unknown[] = []
  const set = (col: string, val: unknown): void => {
    fields.push(`${col} = ?`)
    params.push(val)
  }

  if (patch.title !== undefined) set('title', patch.title.trim())
  if (patch.notes !== undefined) set('notes', patch.notes)
  if (patch.listId !== undefined) set('list_id', patch.listId)
  if (patch.priority !== undefined) set('priority', patch.priority)
  if (patch.scheduledDate !== undefined) set('scheduled_date', patch.scheduledDate)
  if (patch.dueAt !== undefined) set('due_at', patch.dueAt)
  if (patch.dueAllDay !== undefined) set('due_all_day', patch.dueAllDay)
  if (patch.rrule !== undefined) set('rrule', patch.rrule)
  if (patch.repeatFrom !== undefined) set('repeat_from', patch.repeatFrom)
  if (patch.reminderAt !== undefined) set('reminder_at', patch.reminderAt)
  if (patch.reminderOffset !== undefined) set('reminder_offset', patch.reminderOffset)

  if (
    patch.dueAt !== undefined ||
    patch.scheduledDate !== undefined ||
    patch.reminderOffset !== undefined
  ) {
    const cur = conn()
      .prepare('SELECT due_at, scheduled_date, reminder_offset FROM tasks WHERE id = ?')
      .get(id) as
      | { due_at: string | null; scheduled_date: string | null; reminder_offset: number | null }
      | undefined
    const dueAt = patch.dueAt !== undefined ? patch.dueAt : (cur?.due_at ?? null)
    const scheduled = patch.scheduledDate !== undefined ? patch.scheduledDate : (cur?.scheduled_date ?? null)
    const offset =
      patch.reminderOffset !== undefined ? patch.reminderOffset : (cur?.reminder_offset ?? null)
    set('reminder_at', reminderTime(dueAt, scheduled, offset))
    set('notified_at', null)
  }

  fields.push('updated_at = ?')
  params.push(nowIso())

  params.push(id)
  conn()
    .prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`)
    .run(...(params as never[]))

  if (patch.tagNames !== undefined) {
    conn().prepare('DELETE FROM task_tags WHERE task_id = ?').run(id)
    const tagIds = ensureTags(patch.tagNames)
    const stmt = conn().prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?,?)')
    for (const tid of tagIds) stmt.run(id, tid)
  }
  return getTask(id)!
}

export function setTaskStatus(id: string, done: boolean): void {
  const task = getTask(id)
  if (!task) return
  if (done && task.status === 0 && task.rrule) {
    spawnNextOccurrence(task)
  }
  const now = nowIso()
  const conn0 = conn()
  conn0.prepare('UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?').run(
    done ? 1 : 0,
    done ? now : null,
    now,
    id
  )
  if (done) {
    conn0
      .prepare('UPDATE tasks SET status = 1, completed_at = ?, updated_at = ? WHERE parent_id = ? AND deleted_at IS NULL')
      .run(now, now, id)
  }
  if (done) {
    conn0.prepare('UPDATE tasks SET reminder_at = NULL WHERE id = ?').run(id)
  }
}

function spawnNextOccurrence(task: Task): void {
  try {
    let base: Date | null = null
    if (task.repeatFrom === 'completion') {
      base = new Date()
    } else if (task.dueAt) {
      base = new Date(task.dueAt)
    } else if (task.scheduledDate) {
      const [y, m, d] = task.scheduledDate.split('-').map(Number)
      base = new Date(y, (m ?? 1) - 1, d ?? 1, 9, 0, 0, 0)
    }
    if (!base || !task.rrule) return
    const rule = new RRule({ ...RRule.parseString(task.rrule), dtstart: base })
    const next = rule.after(base, false)
    if (!next) return

    const nextDate = format(next, 'yyyy-MM-dd')
    let nextDue: string | null = null
    if (task.dueAt) {
      const original = new Date(task.dueAt)
      const d = new Date(next)
      d.setHours(original.getHours(), original.getMinutes(), 0, 0)
      nextDue = d.toISOString()
    }
    const created = createTask({
      title: task.title,
      notes: task.notes,
      listId: task.listId,
      priority: task.priority,
      scheduledDate: nextDate,
      dueAt: nextDue,
      dueAllDay: task.dueAllDay,
      rrule: task.rrule,
      repeatFrom: task.repeatFrom,
      reminderOffset: task.reminderOffset,
      tagNames: task.tags.map((t) => t.name)
    })
    for (const sub of task.subtasks ?? []) {
      createTask({ title: sub.title, parentId: created.id, priority: sub.priority })
    }
  } catch (e) {
    console.error('spawnNextOccurrence failed', e)
  }
}

export function getDueReminders(nowIsoStr: string): Task[] {
  const rows = conn()
    .prepare(
      `SELECT t.*, ${TAGS_SUBQUERY}, ${SUBTASK_COUNTS} FROM tasks t
       WHERE t.deleted_at IS NULL AND t.status = 0 AND t.reminder_at IS NOT NULL
         AND t.reminder_at <= ? AND t.notified_at IS NULL
       ORDER BY t.reminder_at ASC LIMIT 20`
    )
    .all(nowIsoStr) as Record<string, unknown>[]
  return rows.map(mapTask)
}

export function markReminderSent(id: string): void {
  conn().prepare('UPDATE tasks SET notified_at = ? WHERE id = ?').run(nowIso(), id)
}

export function deleteTask(id: string): void {
  const now = nowIso()
  const c = conn()
  c.prepare('UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
  c.prepare('UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE parent_id = ?').run(now, now, id)
}

export function restoreTask(id: string): void {
  const now = nowIso()
  const c = conn()
  c.prepare('UPDATE tasks SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now, id)
  c.prepare('UPDATE tasks SET deleted_at = NULL, updated_at = ? WHERE parent_id = ?').run(now, id)
}

export function purgeTrash(): void {
  conn().prepare("DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now','-30 days')").run()
}

export function purgeTask(id: string): void {
  const c = conn()
  c.prepare('DELETE FROM task_tags WHERE task_id = ?').run(id)
  c.prepare('DELETE FROM tasks WHERE parent_id = ?').run(id)
  c.prepare('DELETE FROM tasks WHERE id = ?').run(id)
}

export function reorderTasks(items: { id: string; sortOrder: number }[]): void {
  const stmt = conn().prepare('UPDATE tasks SET sort_order = ?, updated_at = ? WHERE id = ?')
  const now = nowIso()
  for (const it of items) stmt.run(it.sortOrder, now, it.id)
}

export function getFolders(): Folder[] {
  const rows = conn().prepare('SELECT * FROM folders ORDER BY sort_order ASC, created_at ASC').all() as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    sortOrder: Number(r.sort_order),
    createdAt: r.created_at as string
  }))
}

export function createFolder(name: string): Folder {
  const id = randomUUID()
  const now = nowIso()
  const max = conn().prepare('SELECT MAX(sort_order) AS m FROM folders').get() as { m: number | null }
  conn().prepare('INSERT INTO folders (id,name,sort_order,created_at) VALUES (?,?,?,?)').run(id, name, (max.m ?? 0) + 1024, now)
  return { id, name, sortOrder: (max.m ?? 0) + 1024, createdAt: now }
}

export function getLists(): List[] {
  const rows = conn()
    .prepare(
      `SELECT l.*, (SELECT COUNT(*) FROM tasks t WHERE t.list_id = l.id AND t.status = 0 AND t.deleted_at IS NULL AND t.parent_id IS NULL) AS cnt
       FROM lists l WHERE l.archived_at IS NULL ORDER BY l.sort_order ASC, l.created_at ASC`
    )
    .all() as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r.id as string,
    folderId: (r.folder_id as string) ?? null,
    name: r.name as string,
    color: (r.color as string) ?? null,
    icon: (r.icon as string) ?? null,
    sortOrder: Number(r.sort_order),
    isPinned: Number(r.is_pinned),
    archivedAt: (r.archived_at as string) ?? null,
    createdAt: r.created_at as string,
    count: Number(r.cnt ?? 0)
  }))
}

export function createList(input: { name: string; color?: string; icon?: string; folderId?: string | null }): List {
  const id = randomUUID()
  const now = nowIso()
  const max = conn().prepare('SELECT MAX(sort_order) AS m FROM lists').get() as { m: number | null }
  const order = (max.m ?? 0) + 1024
  conn()
    .prepare('INSERT INTO lists (id,folder_id,name,color,icon,sort_order,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, input.folderId ?? null, input.name, input.color ?? null, input.icon ?? null, order, now)
  return {
    id,
    folderId: input.folderId ?? null,
    name: input.name,
    color: input.color ?? null,
    icon: input.icon ?? null,
    sortOrder: order,
    isPinned: 0,
    archivedAt: null,
    createdAt: now,
    count: 0
  }
}

export function updateList(id: string, patch: Partial<Pick<List, 'name' | 'color' | 'icon' | 'folderId' | 'isPinned'>>): void {
  const fields: string[] = []
  const params: unknown[] = []
  if (patch.name !== undefined) {
    fields.push('name = ?')
    params.push(patch.name)
  }
  if (patch.color !== undefined) {
    fields.push('color = ?')
    params.push(patch.color)
  }
  if (patch.icon !== undefined) {
    fields.push('icon = ?')
    params.push(patch.icon)
  }
  if (patch.folderId !== undefined) {
    fields.push('folder_id = ?')
    params.push(patch.folderId)
  }
  if (patch.isPinned !== undefined) {
    fields.push('is_pinned = ?')
    params.push(patch.isPinned)
  }
  if (!fields.length) return
  params.push(id)
  conn().prepare(`UPDATE lists SET ${fields.join(', ')} WHERE id = ?`).run(...(params as never[]))
}

export function deleteList(id: string): void {
  const c = conn()
  c.prepare('UPDATE tasks SET list_id = NULL WHERE list_id = ?').run(id)
  c.prepare('DELETE FROM lists WHERE id = ?').run(id)
}

export function getTags(): Tag[] {
  const rows = conn()
    .prepare(
      `SELECT tg.*, (SELECT COUNT(*) FROM task_tags tt JOIN tasks t ON t.id = tt.task_id
        WHERE tt.tag_id = tg.id AND t.deleted_at IS NULL AND t.status = 0) AS cnt
       FROM tags tg ORDER BY tg.name ASC`
    )
    .all() as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    color: (r.color as string) ?? null,
    count: Number(r.cnt ?? 0)
  }))
}

export function createTag(name: string, color?: string): Tag {
  const existing = conn().prepare('SELECT * FROM tags WHERE name = ?').get(name) as
    | Record<string, unknown>
    | undefined
  if (existing) {
    return { id: existing.id as string, name: existing.name as string, color: (existing.color as string) ?? null }
  }
  const id = randomUUID()
  conn().prepare('INSERT INTO tags (id,name,color) VALUES (?,?,?)').run(id, name, color ?? null)
  return { id, name, color: color ?? null }
}

export function deleteTag(id: string): void {
  conn().prepare('DELETE FROM tags WHERE id = ?').run(id)
}

export function getSidebar(): SidebarData {
  const now = new Date()
  const today = dayStr(now)
  const tomorrowStart = startOfDay(addDays(now, 1)).toISOString()
  const in7 = dayStr(addDays(now, 7))
  const in8Start = startOfDay(addDays(now, 8)).toISOString()

  const count = (sql: string, ...params: unknown[]): number => {
    const r = conn().prepare(sql).get(...(params as never[])) as { c: number }
    return r.c
  }

  const counts: Record<string, number> = {
    inbox: count('SELECT COUNT(*) AS c FROM tasks WHERE deleted_at IS NULL AND parent_id IS NULL AND status=0 AND list_id IS NULL'),
    today: count(
      'SELECT COUNT(*) AS c FROM tasks WHERE deleted_at IS NULL AND parent_id IS NULL AND status=0 AND ((scheduled_date IS NOT NULL AND scheduled_date <= ?) OR (due_at IS NOT NULL AND due_at < ?))',
      today,
      tomorrowStart
    ),
    upcoming: count(
      'SELECT COUNT(*) AS c FROM tasks WHERE deleted_at IS NULL AND parent_id IS NULL AND status=0 AND ((scheduled_date IS NOT NULL AND scheduled_date > ? AND scheduled_date <= ?) OR (due_at IS NOT NULL AND due_at >= ? AND due_at < ?))',
      today,
      in7,
      tomorrowStart,
      in8Start
    ),
    all: count('SELECT COUNT(*) AS c FROM tasks WHERE deleted_at IS NULL AND parent_id IS NULL AND status=0'),
    someday: count(
      'SELECT COUNT(*) AS c FROM tasks WHERE deleted_at IS NULL AND parent_id IS NULL AND status=0 AND scheduled_date IS NULL AND due_at IS NULL'
    ),
    completed: count('SELECT COUNT(*) AS c FROM tasks WHERE deleted_at IS NULL AND parent_id IS NULL AND status=1'),
    trash: count('SELECT COUNT(*) AS c FROM tasks WHERE deleted_at IS NOT NULL AND parent_id IS NULL')
  }

  return { folders: getFolders(), lists: getLists(), tags: getTags(), counts }
}

export function searchTasks(q: string): Task[] {
  const term = `%${q.trim()}%`
  if (!q.trim()) return []
  const rows = conn()
    .prepare(
      `SELECT t.*, ${TAGS_SUBQUERY}, ${SUBTASK_COUNTS} FROM tasks t
       WHERE t.deleted_at IS NULL AND (t.title LIKE ? OR t.notes LIKE ? OR t.id IN (
         SELECT tt.task_id FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tg.name LIKE ?
       ))
       ORDER BY t.status ASC, t.updated_at DESC LIMIT 60`
    )
    .all(term, term, term) as Record<string, unknown>[]
  return rows.map(mapTask)
}

export function checkpoint(): void {
  try {
    conn().exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } catch {
    /* ignore */
  }
}

export function getAllData(): {
  exportedAt: string
  folders: Folder[]
  lists: List[]
  tags: Tag[]
  tasks: Task[]
} {
  const rows = conn()
    .prepare(
      `SELECT t.*, ${TAGS_SUBQUERY}, ${SUBTASK_COUNTS} FROM tasks t
       WHERE t.deleted_at IS NULL ORDER BY t.created_at ASC`
    )
    .all() as Record<string, unknown>[]
  return {
    exportedAt: new Date().toISOString(),
    folders: getFolders(),
    lists: getLists(),
    tags: getTags(),
    tasks: rows.map(mapTask)
  }
}

export function getSetting(key: string): string | null {
  const r = conn().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return r?.value ?? null
}

export function setSetting(key: string, value: string): void {
  conn()
    .prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}
