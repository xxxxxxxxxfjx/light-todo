import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { addDays, format, isValid, parseISO, startOfDay, startOfWeek } from 'date-fns'
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
  ViewKey,
  WeeklyReviewData,
  ListSection,
  SavedFilter,
  FilterQuery,
  DayReview
} from '../shared/types'
import { buildFilterSql, emptyFilterQuery, queryHasField } from '../shared/filter-query.ts'
import { DEFAULT_PET_SETTINGS, LEGACY_PET_SETTINGS } from '../shared/pet.ts'

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
  someday        INTEGER NOT NULL DEFAULT 0,
  scheduled_date TEXT,
  due_at         TEXT,
  due_all_day    INTEGER NOT NULL DEFAULT 0,
  rrule          TEXT,
  repeat_from    TEXT,
  reminder_at    TEXT,
  reminder_offset INTEGER,
  notified_at    TEXT,
  estimate_min   INTEGER,
  actual_min     INTEGER,
  section_id     TEXT,
  escalate_interval INTEGER,
  escalate_until TEXT,
  next_escalate_at TEXT,
  urgent         INTEGER NOT NULL DEFAULT 0,
  completed_at   TEXT,
  deleted_at     TEXT,
  deleted_batch  TEXT,
  sort_order     REAL NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_list     ON tasks(list_id, status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_tasks_sched    ON tasks(scheduled_date, status);
CREATE INDEX IF NOT EXISTS idx_tasks_due      ON tasks(due_at, status);
CREATE INDEX IF NOT EXISTS idx_tasks_parent   ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_reminder ON tasks(reminder_at);
CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status, deleted_at, parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(status, completed_at);

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
CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag_id);

-- 搜索索引：独立 FTS5 表（非 external content），rowid 由 FTS 自己管理，
-- task_id 只是普通列，避免 external-content 的 rowid 映射问题。
-- trigram 分词对中英文都按 3 字符片段匹配；少于 3 字符的查询由 LIKE 兜底。
CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
  task_id UNINDEXED,
  title,
  notes,
  tags,
  tokenize='trigram'
);

-- 任务新增/标题备注变更/物理删除时维护索引行；tags 由 task_tags 触发器维护。
CREATE TRIGGER IF NOT EXISTS tasks_fts_after_insert AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts (task_id, title, notes, tags)
  VALUES (
    NEW.id,
    NEW.title,
    NEW.notes,
    COALESCE((
      SELECT group_concat(tg.name, ' ')
      FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id
      WHERE tt.task_id = NEW.id
    ), '')
  );
END;

CREATE TRIGGER IF NOT EXISTS tasks_fts_after_update AFTER UPDATE OF title, notes ON tasks BEGIN
  UPDATE tasks_fts SET title = NEW.title, notes = NEW.notes WHERE task_id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS tasks_fts_after_delete AFTER DELETE ON tasks BEGIN
  DELETE FROM tasks_fts WHERE task_id = OLD.id;
END;

-- 标签关联变化时重算该任务的 tags 拼接文本（标签名以空格分隔，供 trigram 匹配）。
CREATE TRIGGER IF NOT EXISTS task_tags_fts_after_insert AFTER INSERT ON task_tags BEGIN
  UPDATE tasks_fts
  SET tags = COALESCE((
    SELECT group_concat(tg.name, ' ')
    FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id
    WHERE tt.task_id = NEW.task_id
  ), '')
  WHERE task_id = NEW.task_id;
END;

CREATE TRIGGER IF NOT EXISTS task_tags_fts_after_delete AFTER DELETE ON task_tags BEGIN
  UPDATE tasks_fts
  SET tags = COALESCE((
    SELECT group_concat(tg.name, ' ')
    FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id
    WHERE tt.task_id = OLD.task_id
  ), '')
  WHERE task_id = OLD.task_id;
END;

-- 标签改名会改变已索引的 tags 文本，重命名时同步所有关联任务。
CREATE TRIGGER IF NOT EXISTS tags_fts_after_rename AFTER UPDATE OF name ON tags BEGIN
  UPDATE tasks_fts
  SET tags = COALESCE((
    SELECT group_concat(tg.name, ' ')
    FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id
    WHERE tt.task_id = tasks_fts.task_id
  ), '')
  WHERE task_id IN (SELECT task_id FROM task_tags WHERE tag_id = NEW.id);
END;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 清单分区（Things 式 Heading）。任务通过 tasks.section_id 归组。
CREATE TABLE IF NOT EXISTS list_sections (
  id          TEXT PRIMARY KEY,
  list_id     TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sort_order  REAL NOT NULL DEFAULT 0,
  collapsed   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sections_list ON list_sections(list_id, sort_order);

-- 保存的智能过滤器。query_json 存结构化 AST，不存查询文本，避免解析歧义。
CREATE TABLE IF NOT EXISTS saved_filters (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  query_json  TEXT NOT NULL,
  color       TEXT,
  pinned      INTEGER NOT NULL DEFAULT 0,
  sort_order  REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

-- 每日收尾（关机仪式）。
CREATE TABLE IF NOT EXISTS day_reviews (
  date         TEXT PRIMARY KEY,
  rating       INTEGER,
  note         TEXT NOT NULL DEFAULT '',
  reviewed_at  TEXT NOT NULL
);

-- 过期任务处理记录，用于周复盘统计「顺延次数」。
CREATE TABLE IF NOT EXISTS replan_log (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL,
  task_id    TEXT NOT NULL,
  action     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_replan_date ON replan_log(date);

-- 实际用时明细；tasks.actual_min 是它们的合计。
CREATE TABLE IF NOT EXISTS time_entries (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at   TEXT NOT NULL,
  minutes    INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_time_task ON time_entries(task_id);

-- 只读 ICS 订阅：单行配置（id=1）。外部日历只拉取到本地展示，绝不回写。
CREATE TABLE IF NOT EXISTS calendar_subscription (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  url            TEXT NOT NULL,
  name           TEXT,
  last_synced_at TEXT,
  last_error     TEXT,
  updated_at     TEXT NOT NULL
);

-- 已同步的外部日程快照。每次同步按订阅整体替换，作为只读展示数据。
CREATE TABLE IF NOT EXISTS calendar_events (
  id              TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  uid             TEXT,
  title           TEXT NOT NULL,
  description     TEXT,
  start_at        TEXT NOT NULL,
  end_at          TEXT,
  all_day         INTEGER NOT NULL DEFAULT 0,
  rrule           TEXT,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_range
  ON calendar_events(subscription_id, start_at, end_at);
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
  // WAL 下 NORMAL 兼顾安全与写入速度（崩溃最多丢最后几条事务，不会损坏库）
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA)
  // 在 seedIfEmpty 之前记录老库特征。Seeded 标记是 0.2.x 才引入的，更早的库
  // 可能没有它，但通常已有清单或桌宠位置，不能把它们误判成新装。
  const existingListCount = (
    conn().prepare('SELECT COUNT(*) AS c FROM lists').get() as { c: number }
  ).c
  const existingTaskCount = (
    conn().prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }
  ).c
  const isExistingInstall =
    getSetting('seeded') === '1' ||
    getSetting('pet_position') !== null ||
    existingListCount > 0 ||
    existingTaskCount > 0
  ensureColumn('tasks', 'reminder_offset', 'INTEGER')
  ensureColumn('tasks', 'notified_at', 'TEXT')
  ensureColumn('tasks', 'next_occurrence_id', 'TEXT')
  ensureColumn('tasks', 'deleted_batch', 'TEXT')
  ensureColumn('tasks', 'estimate_min', 'INTEGER')
  ensureColumn('tasks', 'actual_min', 'INTEGER')
  ensureColumn('tasks', 'section_id', 'TEXT')
  ensureColumn('tasks', 'escalate_interval', 'INTEGER')
  ensureColumn('tasks', 'escalate_until', 'TEXT')
  ensureColumn('tasks', 'next_escalate_at', 'TEXT')
  ensureColumn('tasks', 'urgent', 'INTEGER NOT NULL DEFAULT 0')
  const hadSomeday = conn()
    .prepare('PRAGMA table_info(tasks)')
    .all()
    .some((column) => (column as { name: string }).name === 'someday')
  ensureColumn('tasks', 'someday', 'INTEGER NOT NULL DEFAULT 0')
  if (!hadSomeday) {
    // 旧版本把无日期任务同时放在「今天」和「也许」；升级后归入也许，避免继续污染今天。
    conn()
      .prepare(
        `UPDATE tasks SET someday = 1
         WHERE scheduled_date IS NULL AND due_at IS NULL AND deleted_at IS NULL AND parent_id IS NULL`
      )
      .run()
  }
  seedIfEmpty()
  seedPetSettings(isExistingInstall)
  backfillSearchIndex()
}

/**
 * 幂等回填搜索索引：
 * - 只为 tasks_fts 中不存在的任务插入行（索引为空时即全量回填）；
 * - 删除 tasks 已不存在（物理删除/旧库残留）的孤儿索引行。
 * 触发器已覆盖日常写入，这里只负责升级旧库和修复索引缺行。
 */
function backfillSearchIndex(): void {
  const c = conn()
  c.prepare(
    `INSERT INTO tasks_fts (task_id, title, notes, tags)
     SELECT t.id, t.title, t.notes,
       COALESCE((
         SELECT group_concat(tg.name, ' ')
         FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id
         WHERE tt.task_id = t.id
       ), '')
     FROM tasks t
     WHERE t.id NOT IN (SELECT task_id FROM tasks_fts)`
  ).run()
  c.prepare('DELETE FROM tasks_fts WHERE task_id NOT IN (SELECT id FROM tasks)').run()
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

// Savepoints also work when an import or another operation already owns a transaction.
let transactionId = 0
export function transaction<T>(action: () => T): T {
  const name = `operation_${++transactionId}`
  conn().exec(`SAVEPOINT ${name}`)
  try {
    const result = action()
    conn().exec(`RELEASE ${name}`)
    return result
  } catch (error) {
    conn().exec(`ROLLBACK TO ${name}; RELEASE ${name}`)
    throw error
  }
}

export function restoreTaskMetadata(id: string, data: Partial<Task>): void {
  conn().prepare(`UPDATE tasks SET status=?, completed_at=?, created_at=?, updated_at=?,
    sort_order=?, notified_at=? WHERE id=?`).run(data.status ?? 0, data.completedAt ?? null,
    data.createdAt ?? nowIso(), data.updatedAt ?? nowIso(), data.sortOrder ?? 0, data.notifiedAt ?? null, id)
}

export function restoreOccurrenceLink(id: string, nextId: string): void {
  conn().prepare('UPDATE tasks SET next_occurrence_id=? WHERE id=?').run(nextId, id)
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

function assertDateField(value: unknown, label: string, dateOnly: boolean): void {
  if (value === null || value === undefined || value === '') return
  if (typeof value !== 'string') throw new Error(`${label}格式无效`)
  const date = dateOnly ? parseISO(value) : new Date(value)
  if (!isValid(date)) throw new Error(`${label}格式无效`)
  if (dateOnly && format(date, 'yyyy-MM-dd') !== value) throw new Error(`${label}格式无效`)
}

function assertRrule(rule: unknown): void {
  if (rule === null || rule === undefined || rule === '') return
  if (typeof rule !== 'string') throw new Error('重复规则无效')
  try {
    RRule.parseString(rule)
  } catch {
    throw new Error('重复规则无效')
  }
}

function validateTaskFields(input: {
  scheduledDate?: string | null
  dueAt?: string | null
  reminderAt?: string | null
  rrule?: string | null
}): void {
  assertDateField(input.scheduledDate, '计划日期', true)
  assertDateField(input.dueAt, '截止时间', false)
  assertDateField(input.reminderAt, '提醒时间', false)
  assertRrule(input.rrule)
}

function seedPetSettings(isExistingInstall: boolean): void {
  // 只在从未写入过桌宠设置时补默认值；用户显式设置（包括关闭）永不覆盖。
  if (getSetting('pet_settings') !== null) return
  setSetting(
    'pet_settings',
    JSON.stringify(isExistingInstall ? LEGACY_PET_SETTINGS : DEFAULT_PET_SETTINGS)
  )
}

function seedIfEmpty(): void {
  const listCount = conn().prepare('SELECT COUNT(*) AS c FROM lists').get() as { c: number }
  const taskCount = conn().prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }
  // A user may legitimately delete every list/task. Once seeded (or once the
  // database already has data), never re-create demo content.
  if (listCount.c > 0 || taskCount.c > 0 || getSetting('seeded') === '1') {
    if (getSetting('seeded') !== '1') setSetting('seeded', '1')
    return
  }

  transaction(() => {
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
    conn().prepare('INSERT OR IGNORE INTO tags (id,name,color) VALUES (?,?,?)').run(tagUrgent, '紧急', '#d13438')
    conn().prepare('INSERT OR IGNORE INTO tags (id,name,color) VALUES (?,?,?)').run(tagReport, '汇报', '#8764b8')

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
    setSetting('seeded', '1')
  })
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
    someday: Number(r.someday ?? 0) === 1,
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
    estimateMin: r.estimate_min === null || r.estimate_min === undefined ? null : Number(r.estimate_min),
    actualMin: r.actual_min === null || r.actual_min === undefined ? null : Number(r.actual_min),
    sectionId: (r.section_id as string) ?? null,
    escalateInterval:
      r.escalate_interval === null || r.escalate_interval === undefined
        ? null
        : Number(r.escalate_interval),
    escalateUntil: (r.escalate_until as string) ?? null,
    nextEscalateAt: (r.next_escalate_at as string) ?? null,
    urgent: Number(r.urgent ?? 0) === 1,
    completedAt: (r.completed_at as string) ?? null,
    deletedAt: (r.deleted_at as string) ?? null,
    sortOrder: Number(r.sort_order ?? 0),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    tags: r.tags_json ? (JSON.parse(r.tags_json as string) as Tag[]) : [],
    nextOccurrenceId: (r.next_occurrence_id as string) ?? null,
    subtaskCount: Number(r.subtask_count ?? 0),
    subtaskDone: Number(r.subtask_done ?? 0)
  }
}

export function listTasks(opts: {
  view: ViewKey
  listId?: string
  tagId?: string
  filterId?: string
  limit?: number
  offset?: number
  dateFrom?: string
  dateTo?: string
}): Task[] {
  const now = new Date()
  const today = dayStr(now)
  const tomorrow = dayStr(addDays(now, 1))
  const in7 = dayStr(addDays(now, 7))
  const tomorrowStart = startOfDay(addDays(now, 1)).toISOString()
  const in8Start = startOfDay(addDays(now, 8)).toISOString()
  const dow = now.getDay()
  const weekEnd = dayStr(addDays(now, dow === 0 ? 0 : 7 - dow))

  let where = 't.deleted_at IS NULL AND t.parent_id IS NULL'
  const params: unknown[] = []
  let order = 't.sort_order ASC, t.created_at DESC'
  let limit = opts.limit ?? 1000

  switch (opts.view) {
    case 'today':
      where +=
        ' AND t.status = 0 AND t.someday = 0 AND ((t.scheduled_date IS NOT NULL AND t.scheduled_date <= ?) OR (t.due_at IS NOT NULL AND t.due_at < ?))'
      params.push(today, tomorrowStart)
      order = `CASE WHEN (t.due_at IS NOT NULL AND t.due_at < '${now.toISOString()}') OR (t.scheduled_date IS NOT NULL AND t.scheduled_date < '${today}') THEN 0 ELSE 1 END, t.sort_order ASC, t.created_at DESC`
      break
    case 'inbox':
      where +=
        ' AND t.status = 0 AND t.someday = 0 AND t.list_id IS NULL AND t.scheduled_date IS NULL AND t.due_at IS NULL'
      break
    case 'upcoming':
      where +=
        ' AND t.status = 0 AND t.someday = 0 AND ((t.scheduled_date IS NOT NULL AND t.scheduled_date > ? AND t.scheduled_date <= ?) OR (t.due_at IS NOT NULL AND t.due_at >= ? AND t.due_at < ?))'
      params.push(today, in7, tomorrowStart, in8Start)
      break
    case 'all':
      where += ' AND t.status = 0'
      break
    case 'someday':
      where += ' AND t.status = 0 AND t.someday = 1'
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
      if (opts.dateFrom && opts.dateTo) {
        const [fy, fm, fd] = opts.dateFrom.split('-').map(Number)
        const [ty, tm, td] = opts.dateTo.split('-').map(Number)
        const from = new Date(fy, fm - 1, fd).toISOString()
        const until = new Date(ty, tm - 1, td + 1).toISOString()
        // Match CalendarView's precedence: planned day, otherwise local due day.
        where += ' AND ((t.scheduled_date BETWEEN ? AND ?) OR (t.scheduled_date IS NULL AND t.due_at >= ? AND t.due_at < ?))'
        params.push(opts.dateFrom, opts.dateTo, from, until)
      }
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
    case 'filter': {
      const filter = opts.filterId ? getSavedFilter(opts.filterId) : null
      const built = buildFilterSql(filter?.query ?? emptyFilterQuery(), {
        today,
        tomorrow,
        weekEnd,
        nowIso: now.toISOString()
      })
      where += ` AND t.deleted_at IS NULL AND ${queryHasField(filter?.query ?? emptyFilterQuery(), 'status') ? '' : 't.status = 0 AND '}${built.sql}`
      params.push(...built.params)
      break
    }
  }

  const sql = `SELECT t.*, ${TAGS_SUBQUERY}, ${SUBTASK_COUNTS}
    FROM tasks t WHERE ${where} ORDER BY ${order}, t.id LIMIT ? OFFSET ?`
  params.push(limit)
  params.push(opts.offset ?? 0)
  const rows = conn().prepare(sql).all(...(params as never[])) as Record<string, unknown>[]
  return rows.map(mapTask)
}

/**
 * 查询指定时间区间内完成的任务（用于任务岛“今天已完成”）。
 * 直接用 completed_at 的 ISO 区间走索引，避免为了取当天完成而扫描全部历史再过滤。
 */
export function listCompletedBetween(
  fromIso: string,
  toIso: string,
  limit = 500,
  offset = 0
): Task[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 500
  const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0
  const rows = conn()
    .prepare(
      `SELECT t.*, ${TAGS_SUBQUERY}, ${SUBTASK_COUNTS}
       FROM tasks t
       WHERE t.deleted_at IS NULL AND t.parent_id IS NULL AND t.status = 1
         AND t.completed_at IS NOT NULL AND t.completed_at >= ? AND t.completed_at < ?
       ORDER BY t.completed_at DESC, t.id ASC
       LIMIT ? OFFSET ?`
    )
    .all(fromIso, toIso, safeLimit, safeOffset) as Record<string, unknown>[]
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
  // 顶层任务：新任务排最上面（sort_order 越小越靠前）；子任务：追加到末尾
  if (parentId) {
    const row = conn()
      .prepare(
        `SELECT MAX(sort_order) AS m FROM tasks WHERE deleted_at IS NULL
         AND list_id IS ? AND parent_id IS ?`
      )
      .get(listId, parentId) as { m: number | null }
    return (row.m ?? 0) + 1024
  }
  const row = conn()
    .prepare(
      `SELECT MIN(sort_order) AS m FROM tasks WHERE deleted_at IS NULL
       AND list_id IS ? AND parent_id IS NULL`
    )
    .get(listId) as { m: number | null }
  return (row.m ?? 0) - 1024
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
  if (typeof input.title !== 'string' || !input.title.trim()) throw new Error('任务标题不能为空')
  validateTaskFields(input)
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
  const someday = input.someday && !input.scheduledDate && !input.dueAt ? 1 : 0
  const reminderAt =
    input.reminderAt ??
    reminderTime(input.dueAt ?? null, input.scheduledDate ?? null, offset)
  conn()
    .prepare(
      `INSERT INTO tasks (id,list_id,parent_id,title,notes,priority,status,someday,scheduled_date,due_at,due_all_day,rrule,repeat_from,reminder_at,reminder_offset,notified_at,estimate_min,section_id,escalate_interval,escalate_until,next_escalate_at,urgent,created_at,updated_at,sort_order)
       VALUES (?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,NULL,?,?,?,?,NULL,?,?,?,?)`
    )
    .run(
      id,
      listId,
      input.parentId ?? null,
      input.title.trim(),
      input.notes ?? '',
      input.priority ?? 0,
      someday,
      input.scheduledDate ?? null,
      input.dueAt ?? null,
      input.dueAllDay ?? 0,
      input.rrule ?? null,
      input.repeatFrom ?? null,
      reminderAt,
      offset,
      input.estimateMin ?? null,
      input.sectionId ?? null,
      input.escalateInterval ?? null,
      input.escalateUntil ?? null,
      input.urgent ? 1 : 0,
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
  return transaction(() => applyTaskUpdate(id, patch))
}

function applyTaskUpdate(id: string, patch: UpdateTaskInput): Task {
  if (patch.title !== undefined && !patch.title.trim()) throw new Error('任务标题不能为空')
  validateTaskFields(patch)
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
  if (patch.someday !== undefined) set('someday', patch.someday ? 1 : 0)
  if (patch.scheduledDate !== undefined) set('scheduled_date', patch.scheduledDate)
  if (patch.dueAt !== undefined) set('due_at', patch.dueAt)
  if (patch.scheduledDate) set('someday', 0)
  if (patch.dueAt) set('someday', 0)
  // A concrete due time means the task is no longer an all-day item.
  if (patch.dueAt !== undefined && patch.dueAt !== null && patch.dueAllDay === undefined) {
    set('due_all_day', 0)
  }
  if (patch.dueAllDay !== undefined) set('due_all_day', patch.dueAllDay)
  if (patch.rrule !== undefined) set('rrule', patch.rrule || null)
  if (patch.repeatFrom !== undefined) set('repeat_from', patch.repeatFrom)
  if (patch.reminderAt !== undefined) set('reminder_at', patch.reminderAt)
  if (patch.reminderOffset !== undefined) set('reminder_offset', patch.reminderOffset)
  if (patch.estimateMin !== undefined) set('estimate_min', patch.estimateMin)
  if (patch.actualMin !== undefined) set('actual_min', patch.actualMin)
  if (patch.sectionId !== undefined) set('section_id', patch.sectionId)
  if (patch.escalateInterval !== undefined) {
    set('escalate_interval', patch.escalateInterval)
    set('next_escalate_at', null)
  }
  if (patch.escalateUntil !== undefined) set('escalate_until', patch.escalateUntil)
  if (patch.urgent !== undefined) set('urgent', patch.urgent ? 1 : 0)

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
    set('next_escalate_at', null)
  }

  fields.push('updated_at = ?')
  params.push(nowIso())

  params.push(id)
  conn()
    .prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`)
    .run(...(params as never[]))

  if (patch.listId !== undefined) {
    conn().prepare(`WITH RECURSIVE children(id) AS (
      SELECT id FROM tasks WHERE parent_id = ? UNION ALL
      SELECT t.id FROM tasks t JOIN children c ON t.parent_id=c.id
    ) UPDATE tasks SET list_id=?, updated_at=? WHERE id IN (SELECT id FROM children)`)
      .run(id, patch.listId, nowIso())
  }

  if (patch.tagNames !== undefined) {
    conn().prepare('DELETE FROM task_tags WHERE task_id = ?').run(id)
    const tagIds = ensureTags(patch.tagNames)
    const stmt = conn().prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?,?)')
    for (const tid of tagIds) stmt.run(id, tid)
  }
  return getTask(id)!
}

export function setTaskStatus(id: string, done: boolean): void {
  transaction(() => changeTaskStatus(id, done))
}

function changeTaskStatus(id: string, done: boolean): void {
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
    // Completing a parent completes the whole subtree, including grandchildren.
    conn0.prepare(`WITH RECURSIVE children(id) AS (
      SELECT id FROM tasks WHERE parent_id = ? AND deleted_at IS NULL
      UNION ALL
      SELECT t.id FROM tasks t JOIN children c ON t.parent_id = c.id WHERE t.deleted_at IS NULL
    ) UPDATE tasks SET status = 1, completed_at = ?, updated_at = ?, reminder_at = NULL
      WHERE id IN (SELECT id FROM children)`).run(id, now, now)
    conn0.prepare('UPDATE tasks SET reminder_at = NULL WHERE id = ?').run(id)
    conn0.prepare('UPDATE tasks SET next_escalate_at = NULL WHERE id = ?').run(id)
  } else {
    conn0.prepare('UPDATE tasks SET reminder_at = ?, notified_at = NULL, next_escalate_at = NULL WHERE id = ?')
      .run(reminderTime(task.dueAt, task.scheduledDate, task.reminderOffset), id)
  }
}

function spawnNextOccurrence(task: Task): void {
  const existing = conn()
    .prepare('SELECT next_occurrence_id FROM tasks WHERE id=?')
    .get(task.id) as { next_occurrence_id: string | null } | undefined
  // Completion can be undone; each source occurrence can create its successor
  // only once. If that successor was deleted (or purged), forget the stale
  // pointer so a later completion can rebuild the chain.
  if (existing?.next_occurrence_id) {
    const successor = conn()
      .prepare('SELECT id FROM tasks WHERE id = ? AND deleted_at IS NULL')
      .get(existing.next_occurrence_id) as { id: string } | undefined
    if (successor) return
    conn().prepare('UPDATE tasks SET next_occurrence_id = NULL WHERE id = ?').run(task.id)
  }
  if (!task.rrule) return
  let base: Date | null = null
  if (task.repeatFrom === 'completion') {
    base = new Date()
  } else if (task.dueAt) {
    base = new Date(task.dueAt)
  } else if (task.scheduledDate) {
    const [y, m, d] = task.scheduledDate.split('-').map(Number)
    base = new Date(y, (m ?? 1) - 1, d ?? 1, 9, 0, 0, 0)
  } else {
    // A repeat rule without a date used to silently stop the chain.
    base = new Date()
    base.setHours(9, 0, 0, 0)
  }
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
    estimateMin: task.estimateMin,
    sectionId: task.sectionId,
    escalateInterval: task.escalateInterval,
    urgent: task.urgent,
    tagNames: task.tags.map((t) => t.name)
  })
  conn().prepare('UPDATE tasks SET next_occurrence_id=? WHERE id=?').run(created.id, task.id)
  cloneSubtasks(task.id, created.id)
}

function cloneSubtasks(sourceParentId: string, targetParentId: string): void {
  const children = conn()
    .prepare(
      `SELECT t.*, ${TAGS_SUBQUERY} FROM tasks t
       WHERE t.parent_id = ? AND t.deleted_at IS NULL ORDER BY t.sort_order ASC, t.created_at ASC`
    )
    .all(sourceParentId) as Record<string, unknown>[]
  for (const row of children) {
    const sub = mapTask(row)
    const copy = createTask({
      title: sub.title,
      notes: sub.notes,
      parentId: targetParentId,
      priority: sub.priority,
      dueAllDay: sub.dueAllDay,
      tagNames: sub.tags.map((t) => t.name)
    })
    cloneSubtasks(sub.id, copy.id)
  }
}

export function getDueReminders(nowIsoStr: string): Task[] {
  const rows = conn()
    .prepare(
      `SELECT t.*, ${TAGS_SUBQUERY}, ${SUBTASK_COUNTS} FROM tasks t
       WHERE t.deleted_at IS NULL AND t.status = 0
         AND (
           (t.reminder_at IS NOT NULL AND t.reminder_at <= ? AND t.notified_at IS NULL)
           OR (t.next_escalate_at IS NOT NULL AND t.next_escalate_at <= ?
               AND (t.escalate_until IS NULL OR t.escalate_until > ?))
         )
       ORDER BY COALESCE(t.next_escalate_at, t.reminder_at) ASC LIMIT 20`
    )
    .all(nowIsoStr, nowIsoStr, nowIsoStr) as Record<string, unknown>[]
  return rows.map(mapTask)
}

export function markReminderSent(id: string): void {
  const row = conn()
    .prepare('SELECT escalate_interval, escalate_until FROM tasks WHERE id = ?')
    .get(id) as { escalate_interval: number | null; escalate_until: string | null } | undefined
  const interval = Number(row?.escalate_interval ?? 0)
  let next: string | null = null
  if (interval > 0) {
    const candidate = Date.now() + interval * 60000
    const until = row?.escalate_until ? Date.parse(row.escalate_until) : Number.NaN
    if (!Number.isFinite(until) || candidate <= until) next = new Date(candidate).toISOString()
  }
  conn()
    .prepare('UPDATE tasks SET notified_at = ?, next_escalate_at = ? WHERE id = ?')
    .run(nowIso(), next, id)
}

/**
 * Snooze one pending reminder: re-arm reminder_at to now + minutes and clear
 * notified_at so the reminder loop can fire it again. Completed or deleted
 * tasks are ignored, matching the reminder query's own filters.
 */
export function snoozeReminder(id: string, minutes: number): void {
  if (!Number.isFinite(minutes)) throw new Error('稍后提醒时间无效')
  const mins = Math.min(1440, Math.max(1, Math.round(minutes)))
  const now = Date.now()
  conn()
    .prepare(
      `UPDATE tasks SET reminder_at = ?, notified_at = NULL, next_escalate_at = NULL, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL AND status = 0`
    )
    .run(new Date(now + mins * 60000).toISOString(), new Date(now).toISOString(), id)
}

export function deleteTask(id: string): void {
  const now = nowIso()
  const batch = randomUUID()
  const c = conn()
  c.prepare(`WITH RECURSIVE children(id) AS (
    SELECT id FROM tasks WHERE id = ?
    UNION ALL
    SELECT t.id FROM tasks t JOIN children c ON t.parent_id = c.id
  ) UPDATE tasks SET deleted_at = ?, deleted_batch = ?, updated_at = ? WHERE id IN (SELECT id FROM children) AND deleted_at IS NULL`)
    .run(id, now, batch, now)
  // A deleted successor must not block rebuilding the repeat chain later.
  c.prepare(`UPDATE tasks SET next_occurrence_id = NULL WHERE next_occurrence_id IN (
    SELECT id FROM tasks WHERE deleted_at IS NOT NULL
  )`).run()
}

export function restoreTask(id: string): void {
  const now = nowIso()
  const c = conn()
  const root = c.prepare('SELECT deleted_at, deleted_batch FROM tasks WHERE id = ?').get(id) as
    | { deleted_at: string | null; deleted_batch: string | null }
    | undefined
  if (!root?.deleted_at) return
  // Restore only the batch that was deleted together with the root. A child
  // deleted earlier (different batch) stays in the trash.
  if (root.deleted_batch) {
    c.prepare(`WITH RECURSIVE children(id) AS (
      SELECT id FROM tasks WHERE id = ?
      UNION ALL
      SELECT t.id FROM tasks t JOIN children c ON t.parent_id = c.id
    ) UPDATE tasks SET deleted_at = NULL, deleted_batch = NULL, updated_at = ? WHERE id IN (SELECT id FROM children) AND deleted_batch = ?`)
      .run(id, now, root.deleted_batch)
  } else {
    c.prepare(`WITH RECURSIVE children(id) AS (
      SELECT id FROM tasks WHERE id = ?
      UNION ALL
      SELECT t.id FROM tasks t JOIN children c ON t.parent_id = c.id
    ) UPDATE tasks SET deleted_at = NULL, updated_at = ? WHERE id IN (SELECT id FROM children) AND deleted_at = ?`)
      .run(id, now, root.deleted_at)
  }
}

export function purgeTrash(): void {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const c = conn()
  c.prepare(`UPDATE tasks SET next_occurrence_id = NULL WHERE next_occurrence_id IN (
    SELECT id FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?
  )`).run(cutoff)
  c.prepare('DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(cutoff)
}

export function purgeTask(id: string): void {
  const c = conn()
  const ids = c
    .prepare(`WITH RECURSIVE children(id) AS (
      SELECT id FROM tasks WHERE id = ?
      UNION ALL
      SELECT t.id FROM tasks t JOIN children c ON t.parent_id = c.id
    ) SELECT id FROM children`)
    .all(id) as { id: string }[]
  const idList = ids.map((row) => row.id)
  if (!idList.length) return
  const marks = idList.map(() => '?').join(',')
  c.prepare(`UPDATE tasks SET next_occurrence_id = NULL WHERE next_occurrence_id IN (${marks})`).run(...(idList as never[]))
  c.prepare(`DELETE FROM task_tags WHERE task_id IN (${marks})`).run(...(idList as never[]))
  c.prepare(`DELETE FROM tasks WHERE id IN (${marks})`).run(...(idList as never[]))
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

export function updateFolder(id: string, name: string): void {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('文件夹名称不能为空')
  conn().prepare('UPDATE folders SET name = ? WHERE id = ?').run(trimmed, id)
}

export function deleteFolder(id: string): void {
  const c = conn()
  c.prepare('UPDATE lists SET folder_id = NULL WHERE folder_id = ?').run(id)
  c.prepare('DELETE FROM folders WHERE id = ?').run(id)
}

export function getLists(): List[] {
  const rows = conn()
    .prepare(
      `SELECT l.*, COALESCE(c.cnt, 0) AS cnt
       FROM lists l
       LEFT JOIN (
         SELECT list_id, COUNT(*) AS cnt FROM tasks
         WHERE status = 0 AND deleted_at IS NULL AND parent_id IS NULL
         GROUP BY list_id
       ) c ON c.list_id = l.id
       WHERE l.archived_at IS NULL
       ORDER BY l.sort_order ASC, l.created_at ASC`
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
      `SELECT tg.*, COALESCE(c.cnt, 0) AS cnt
       FROM tags tg
       LEFT JOIN (
         SELECT tt.tag_id, COUNT(*) AS cnt
         FROM task_tags tt
         JOIN tasks t ON t.id = tt.task_id AND t.deleted_at IS NULL AND t.status = 0 AND t.parent_id IS NULL
         GROUP BY tt.tag_id
       ) c ON c.tag_id = tg.id
       ORDER BY tg.name ASC`
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

export function updateTag(id: string, patch: { name?: string; color?: string | null }): Tag {
  const cur = conn().prepare('SELECT * FROM tags WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  if (!cur) throw new Error('标签不存在')
  const name = patch.name?.trim() || (cur.name as string)
  const color = patch.color === undefined ? ((cur.color as string) ?? null) : patch.color
  conn().prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').run(name, color, id)
  return { id, name, color }
}

export function deleteTag(id: string): void {
  conn().prepare('DELETE FROM tags WHERE id = ?').run(id)
}

export function clearCompleted(): number {
  const c = conn()
  const ids = c
    .prepare('SELECT id FROM tasks WHERE status = 1 AND deleted_at IS NULL')
    .all() as { id: string }[]
  if (!ids.length) return 0
  c.prepare(`UPDATE tasks SET next_occurrence_id = NULL WHERE next_occurrence_id IN (
    SELECT id FROM tasks WHERE status = 1 AND deleted_at IS NULL
  )`).run()
  const delTag = c.prepare('DELETE FROM task_tags WHERE task_id = ?')
  const del = c.prepare('DELETE FROM tasks WHERE id = ?')
  for (const { id } of ids) {
    delTag.run(id)
    del.run(id)
  }
  return ids.length
}

export function getSidebar(): SidebarData {
  const now = new Date()
  const today = dayStr(now)
  const tomorrowStart = startOfDay(addDays(now, 1)).toISOString()
  const in7 = dayStr(addDays(now, 7))
  const in8Start = startOfDay(addDays(now, 8)).toISOString()

  // One table scan for all sidebar badges. The old version ran seven separate
  // COUNT queries on every task mutation (~36ms on a 10k database).
  // 收件箱只统计没有清单、没有计划日、没有截止时间的顶层未完成任务；
  // 这些任务不再计入「今天」。
  const countRow = conn()
    .prepare(
      `SELECT
        SUM(CASE WHEN deleted_at IS NULL AND status=0 AND someday=0 AND list_id IS NULL AND scheduled_date IS NULL AND due_at IS NULL THEN 1 ELSE 0 END) AS inbox,
        SUM(CASE WHEN deleted_at IS NULL AND status=0 AND someday=0 AND ((scheduled_date IS NOT NULL AND scheduled_date <= ?) OR (due_at IS NOT NULL AND due_at < ?)) THEN 1 ELSE 0 END) AS today,
        SUM(CASE WHEN deleted_at IS NULL AND status=0 AND someday=0 AND priority=3 AND ((scheduled_date IS NOT NULL AND scheduled_date <= ?) OR (due_at IS NOT NULL AND due_at < ?)) THEN 1 ELSE 0 END) AS todayHigh,
        SUM(CASE WHEN deleted_at IS NULL AND status=0 AND someday=0 AND ((scheduled_date IS NOT NULL AND scheduled_date > ? AND scheduled_date <= ?) OR (due_at IS NOT NULL AND due_at >= ? AND due_at < ?)) THEN 1 ELSE 0 END) AS upcoming,
        SUM(CASE WHEN deleted_at IS NULL AND status=0 THEN 1 ELSE 0 END) AS all_count,
        SUM(CASE WHEN deleted_at IS NULL AND status=0 AND someday=1 THEN 1 ELSE 0 END) AS someday,
        SUM(CASE WHEN deleted_at IS NULL AND status=1 THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS trash
       FROM tasks WHERE parent_id IS NULL`
    )
    .get(today, tomorrowStart, today, tomorrowStart, today, in7, tomorrowStart, in8Start) as Record<
    string,
    number | null
  >
  const counts: Record<string, number> = {}
  for (const [key, value] of Object.entries(countRow)) {
    counts[key === 'all_count' ? 'all' : key] = Number(value ?? 0)
  }

  return { folders: getFolders(), lists: getLists(), tags: getTags(), counts }
}

/**
 * 近 7 天（含今天，旧→新）的本地复盘统计。
 *
 * 日期分组必须在 SQLite 里用 `date(..., 'localtime')`：时间戳统一存 ISO UTC，
 * 直接截取 UTC 日期会让东八区凌晨完成/创建的任务落到前一天。仅统计未删除任务；
 * 逾期口径与渲染层 isOverdue 一致：未完成，且截止时间早于当前时刻或计划日早于今天。
 */
export function getWeeklyReview(now = new Date()): WeeklyReviewData {
  const end = startOfDay(now)
  const start = addDays(end, -6)
  const firstDay = dayStr(start)
  const today = dayStr(end)

  // 一次查询覆盖 7 天节奏和 13 周热力图，避免重复扫描完成历史。
  const heatmapStart = dayStr(startOfWeek(addDays(end, -90), { weekStartsOn: 1 }))
  const completedRows = conn()
    .prepare(
      `SELECT date(completed_at, 'localtime') AS day, COUNT(*) AS count
       FROM tasks
       WHERE deleted_at IS NULL AND parent_id IS NULL AND status = 1 AND completed_at IS NOT NULL
         AND date(completed_at, 'localtime') BETWEEN ? AND ?
       GROUP BY day`
    )
    .all(heatmapStart, today) as { day: string; count: number }[]

  const dailyCreated = conn()
    .prepare(
      `SELECT date(created_at, 'localtime') AS day, COUNT(*) AS count
       FROM tasks
       WHERE deleted_at IS NULL AND parent_id IS NULL
         AND date(created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY day`
    )
    .all(firstDay, today) as { day: string; count: number }[]

  const completedByDay = new Map(completedRows.map((row) => [row.day, Number(row.count)]))
  const createdByDay = new Map(dailyCreated.map((row) => [row.day, Number(row.count)]))
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = dayStr(addDays(start, index))
    return {
      date,
      completed: completedByDay.get(date) ?? 0,
      created: createdByDay.get(date) ?? 0
    }
  })

  const heatmap: WeeklyReviewData['heatmap'] = []
  for (let cursor = startOfWeek(addDays(end, -90), { weekStartsOn: 1 }); cursor <= end; cursor = addDays(cursor, 1)) {
    const key = dayStr(cursor)
    heatmap.push({ date: key, completed: completedByDay.get(key) ?? 0 })
  }

  const active = Number(
    (
      conn()
        .prepare(
          `SELECT COUNT(*) AS count FROM tasks
           WHERE deleted_at IS NULL AND parent_id IS NULL AND status = 0`
        )
        .get() as { count: number | null }
    ).count ?? 0
  )

  const overdue = Number(
    (
      conn()
        .prepare(
          `SELECT COUNT(*) AS count FROM tasks
           WHERE deleted_at IS NULL AND parent_id IS NULL AND status = 0
             AND (
               (due_at IS NOT NULL AND julianday(due_at) < julianday(?))
               OR (scheduled_date IS NOT NULL AND scheduled_date < ?)
             )`
        )
        .get(now.toISOString(), today) as { count: number | null }
    ).count ?? 0
  )

  const listRows = conn()
    .prepare(
      `SELECT l.id, l.name, l.color,
         SUM(CASE WHEN t.deleted_at IS NULL AND t.status = 1 AND t.completed_at IS NOT NULL
                   AND date(t.completed_at, 'localtime') BETWEEN ? AND ?
                  THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN t.deleted_at IS NULL AND t.status = 0 THEN 1 ELSE 0 END) AS active
       FROM lists l
       LEFT JOIN tasks t ON t.list_id = l.id AND t.parent_id IS NULL
       WHERE l.archived_at IS NULL
       GROUP BY l.id
       ORDER BY completed DESC, active DESC, l.sort_order ASC, l.created_at ASC`
    )
    .all(firstDay, today) as {
    id: string
    name: string
    color: string | null
    completed: number | null
    active: number | null
  }[]

  const lists: WeeklyReviewData['lists'] = listRows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color ?? null,
    completed: Number(row.completed ?? 0),
    active: Number(row.active ?? 0)
  }))

  const unclassifiedRow = conn()
    .prepare(
      `SELECT
         SUM(CASE WHEN t.status = 1 AND t.completed_at IS NOT NULL
                   AND date(t.completed_at, 'localtime') BETWEEN ? AND ?
                  THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN t.status = 0 THEN 1 ELSE 0 END) AS active
       FROM tasks t
       WHERE t.deleted_at IS NULL AND t.parent_id IS NULL
         AND (
           t.list_id IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM lists l WHERE l.id = t.list_id AND l.archived_at IS NULL
           )
         )`
    )
    .get(firstDay, today) as { completed: number | null; active: number | null }
  const unclassified = {
    id: '',
    name: '未分类',
    color: null,
    completed: Number(unclassifiedRow.completed ?? 0),
    active: Number(unclassifiedRow.active ?? 0)
  }
  // 只有确实存在未分类任务时才展示这一行，避免空库也出现一项“未分类 0/0”。
  if (unclassified.completed > 0 || unclassified.active > 0) lists.push(unclassified)

  lists.sort(
    (a, b) =>
      b.completed - a.completed ||
      b.active - a.active ||
      a.name.localeCompare(b.name, 'zh-CN')
  )

  return {
    days,
    heatmap,
    completed: days.reduce((sum, day) => sum + day.completed, 0),
    created: days.reduce((sum, day) => sum + day.created, 0),
    overdue,
    active,
    lists
  }
}

function likeSearchTasks(raw: string, limit: number, offset: number): Task[] {
  // 转义 LIKE 通配符，避免搜索 "%" 或 "_" 时匹配全部
  const term = `%${raw.replace(/[\\%_]/g, (m) => '\\' + m)}%`
  const rows = conn()
    .prepare(
      `SELECT t.*, ${TAGS_SUBQUERY}, ${SUBTASK_COUNTS} FROM tasks t
       WHERE t.deleted_at IS NULL AND (t.title LIKE ? ESCAPE '\\' OR t.notes LIKE ? ESCAPE '\\' OR t.id IN (
         SELECT tt.task_id FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tg.name LIKE ? ESCAPE '\\'
       ))
       ORDER BY t.status ASC, t.updated_at DESC, t.id ASC LIMIT ? OFFSET ?`
    )
    .all(term, term, term, limit, offset) as Record<string, unknown>[]
  return rows.map(mapTask)
}

/**
 * 把用户输入转成 FTS5 MATCH 表达式：按空白切词，每个词整体作为带引号短语，
 * 词间用 AND 连接。内部双引号按 FTS5 规则双写转义，避免 `-`、`*`、`OR`
 * 之类字符被当成查询语法。
 */
function ftsMatchExpression(raw: string): string {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(' AND ')
}

/**
 * 搜索任务：3 个及以上 Unicode 码点时优先走 FTS5 trigram（中英文均可），
 * 少于 3 个字符、FTS 无结果或 FTS 报错时回退到原来的 LIKE 搜索。
 * 两条路径都排除回收站任务，并支持 limit/offset 分页。
 */
export function searchTasks(q: string, limit = 200, offset = 0): Task[] {
  const raw = q.trim()
  if (!raw) return []
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 200
  const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0

  if (Array.from(raw).length >= 3) {
    try {
      const rows = conn()
        .prepare(
          `SELECT t.*, ${TAGS_SUBQUERY}, ${SUBTASK_COUNTS}
           FROM tasks_fts JOIN tasks t ON t.id = tasks_fts.task_id
           WHERE tasks_fts MATCH ? AND t.deleted_at IS NULL
           ORDER BY bm25(tasks_fts), t.status ASC, t.updated_at DESC, t.id ASC
           LIMIT ? OFFSET ?`
        )
        .all(ftsMatchExpression(raw), safeLimit, safeOffset) as Record<string, unknown>[]
      if (rows.length) return rows.map(mapTask)
    } catch {
      // FTS 语法/运行错误不能让搜索崩掉，直接降级 LIKE。
    }
  }
  return likeSearchTasks(raw, safeLimit, safeOffset)
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

export interface CalendarSubscription {
  id: number
  url: string
  name: string | null
  lastSyncedAt: string | null
  lastError: string | null
  updatedAt: string
}

export interface CalendarEventInput {
  uid?: string | null
  title: string
  description?: string | null
  startAt: string
  endAt?: string | null
  allDay?: boolean
  rrule?: string | null
}

export interface CalendarEvent {
  id: string
  subscriptionId: string
  uid: string | null
  title: string
  description: string | null
  startAt: string
  endAt: string | null
  allDay: boolean
  rrule: string | null
  updatedAt: string
}

interface CalendarSubscriptionRow {
  id: number
  url: string
  name: string | null
  last_synced_at: string | null
  last_error: string | null
  updated_at: string
}

interface CalendarEventRow {
  id: string
  subscription_id: string
  uid: string | null
  title: string
  description: string | null
  start_at: string
  end_at: string | null
  all_day: number
  rrule: string | null
  updated_at: string
}

function mapCalendarSubscription(row: CalendarSubscriptionRow): CalendarSubscription {
  return {
    id: row.id,
    url: row.url,
    name: row.name,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
    updatedAt: row.updated_at
  }
}

function mapCalendarEvent(row: CalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    uid: row.uid,
    title: row.title,
    description: row.description,
    startAt: row.start_at,
    endAt: row.end_at,
    allDay: row.all_day === 1,
    rrule: row.rrule,
    updatedAt: row.updated_at
  }
}

export function getCalendarSubscription(): CalendarSubscription | null {
  const row = conn()
    .prepare('SELECT * FROM calendar_subscription WHERE id = 1')
    .get() as CalendarSubscriptionRow | undefined
  return row ? mapCalendarSubscription(row) : null
}

/**
 * 保存/更新唯一的日历订阅地址。name 省略时保留已有名称；
 * 同步状态（last_synced_at / last_error）由同步流程单独维护。
 */
export function saveCalendarSubscription(url: string, name?: string): CalendarSubscription {
  const cleanUrl = url.trim()
  if (!cleanUrl) throw new Error('日历订阅地址不能为空')
  const cleanName = name?.trim() || null
  const stamp = nowIso()
  conn()
    .prepare(
      `INSERT INTO calendar_subscription (id, url, name, last_synced_at, last_error, updated_at)
       VALUES (1, ?, ?, NULL, NULL, ?)
       ON CONFLICT(id) DO UPDATE SET
         url = excluded.url,
         name = COALESCE(excluded.name, calendar_subscription.name),
         updated_at = excluded.updated_at`
    )
    .run(cleanUrl, cleanName, stamp)
  return getCalendarSubscription()!
}

export function markCalendarSubscriptionSynced(at: string = nowIso()): void {
  conn()
    .prepare(
      `UPDATE calendar_subscription
       SET last_synced_at = ?, last_error = NULL, updated_at = ?
       WHERE id = 1`
    )
    .run(at, at)
}

export function setCalendarSubscriptionError(message: string | null): void {
  conn()
    .prepare('UPDATE calendar_subscription SET last_error = ?, updated_at = ? WHERE id = 1')
    .run(message, nowIso())
}

/**
 * 同步成功后的唯一提交点：地址、名称、事件快照和同步状态在同一个事务里切换。
 * 拉取/解析失败时不会走到这里，旧订阅与旧事件保持原样。
 */
export function commitCalendarSubscriptionSync(
  subscriptionId: string,
  url: string,
  name: string | null,
  events: CalendarEventInput[],
  syncedAt: string = nowIso()
): number {
  const cleanUrl = url.trim()
  if (!cleanUrl) throw new Error('日历订阅地址不能为空')
  const cleanName = name?.trim() || null
  const stamp = nowIso()
  return transaction(() => {
    conn()
      .prepare(
        `INSERT INTO calendar_subscription (id, url, name, last_synced_at, last_error, updated_at)
         VALUES (1, ?, ?, ?, NULL, ?)
         ON CONFLICT(id) DO UPDATE SET
           url = excluded.url,
           name = excluded.name,
           last_synced_at = excluded.last_synced_at,
           last_error = NULL,
           updated_at = excluded.updated_at`
      )
      .run(cleanUrl, cleanName, syncedAt, stamp)
    return replaceCalendarEvents(subscriptionId, events)
  })
}

/**
 * 同一订阅整体替换：事务内先删旧快照再插入新快照，避免半次同步留下混合数据。
 * 事件 id 由本地生成，仅用于渲染 key；外部 UID 单独保存。
 */
export function replaceCalendarEvents(
  subscriptionId: string,
  events: CalendarEventInput[]
): number {
  const owner = String(subscriptionId)
  return transaction(() => {
    conn().prepare('DELETE FROM calendar_events WHERE subscription_id = ?').run(owner)
    const insert = conn().prepare(
      `INSERT INTO calendar_events
         (id, subscription_id, uid, title, description, start_at, end_at, all_day, rrule, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const stamp = nowIso()
    for (const event of events) {
      insert.run(
        randomUUID(),
        owner,
        event.uid ?? null,
        event.title,
        event.description ?? null,
        event.startAt,
        event.endAt ?? null,
        event.allDay ? 1 : 0,
        event.rrule ?? null,
        stamp
      )
    }
    return events.length
  })
}

function calendarRangeBoundary(value: string, endOfDay: boolean): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('日历查询范围不能为空')
  const raw = value.trim()
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw)
  if (dateOnly) {
    const [year, month, day] = raw.split('-').map(Number)
    const date = new Date(
      year,
      month - 1,
      day,
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0
    )
    if (Number.isNaN(date.getTime()) || format(date, 'yyyy-MM-dd') !== raw) {
      throw new Error('日历查询日期无效')
    }
    return date.toISOString()
  }
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) throw new Error('日历查询日期无效')
  return parsed.toISOString()
}

/**
 * 返回与 [fromIso, toIso] 有交集的事件。from/to 既接受完整 ISO 时间，
 * 也接受 yyyy-MM-dd：后者按本地日边界展开，以正确覆盖全天事件。
 */
export function getCalendarEvents(fromIso: string, toIso: string): CalendarEvent[] {
  const from = calendarRangeBoundary(fromIso, false)
  const to = calendarRangeBoundary(toIso, true)
  if (from > to) throw new Error('日历查询范围无效')
  const rows = conn()
    .prepare(
      `SELECT * FROM calendar_events
       WHERE start_at <= ? AND COALESCE(end_at, start_at) >= ?
       ORDER BY start_at ASC, id ASC`
    )
    .all(to, from) as unknown as CalendarEventRow[]
  return rows.map(mapCalendarEvent)
}

/** 清除订阅配置和全部已同步快照（单订阅模型）。 */
export function clearCalendarSubscription(): void {
  transaction(() => {
    conn().prepare('DELETE FROM calendar_events').run()
    conn().prepare('DELETE FROM calendar_subscription WHERE id = 1').run()
  })
}

// ─────────────────────────────────────────────────────────────
// 清单分区（Heading）
// ─────────────────────────────────────────────────────────────

export function getSections(listId: string): ListSection[] {
  const rows = conn()
    .prepare('SELECT * FROM list_sections WHERE list_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(listId) as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r.id as string,
    listId: r.list_id as string,
    name: r.name as string,
    sortOrder: Number(r.sort_order ?? 0),
    collapsed: Number(r.collapsed ?? 0) === 1,
    createdAt: r.created_at as string
  }))
}

export function createSection(listId: string, name: string): ListSection {
  const clean = name.trim()
  if (!clean) throw new Error('分区名称不能为空')
  const id = randomUUID()
  const now = nowIso()
  const max = conn()
    .prepare('SELECT MAX(sort_order) AS m FROM list_sections WHERE list_id = ?')
    .get(listId) as { m: number | null }
  const order = (max.m ?? 0) + 1024
  conn()
    .prepare(
      'INSERT INTO list_sections (id,list_id,name,sort_order,collapsed,created_at) VALUES (?,?,?,?,0,?)'
    )
    .run(id, listId, clean, order, now)
  return { id, listId, name: clean, sortOrder: order, collapsed: false, createdAt: now }
}

export function updateSection(
  id: string,
  patch: { name?: string; collapsed?: boolean; sortOrder?: number }
): void {
  const fields: string[] = []
  const params: unknown[] = []
  if (patch.name !== undefined) {
    const clean = patch.name.trim()
    if (!clean) throw new Error('分区名称不能为空')
    fields.push('name = ?')
    params.push(clean)
  }
  if (patch.collapsed !== undefined) {
    fields.push('collapsed = ?')
    params.push(patch.collapsed ? 1 : 0)
  }
  if (patch.sortOrder !== undefined) {
    fields.push('sort_order = ?')
    params.push(patch.sortOrder)
  }
  if (!fields.length) return
  params.push(id)
  conn().prepare(`UPDATE list_sections SET ${fields.join(', ')} WHERE id = ?`).run(...(params as never[]))
}

export function deleteSection(id: string): void {
  transaction(() => {
    conn().prepare('UPDATE tasks SET section_id = NULL WHERE section_id = ?').run(id)
    conn().prepare('DELETE FROM list_sections WHERE id = ?').run(id)
  })
}

// ─────────────────────────────────────────────────────────────
// 智能过滤器
// ─────────────────────────────────────────────────────────────

function mapSavedFilter(row: Record<string, unknown>): SavedFilter {
  let query: FilterQuery = emptyFilterQuery()
  try {
    const parsed = JSON.parse(row.query_json as string) as FilterQuery
    if (parsed && Array.isArray(parsed.conditions)) query = parsed
  } catch {
    /* corrupted filter falls back to empty */
  }
  return {
    id: row.id as string,
    name: row.name as string,
    query,
    color: (row.color as string) ?? null,
    pinned: Number(row.pinned ?? 0),
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: row.created_at as string
  }
}

export function getSavedFilters(): SavedFilter[] {
  const rows = conn()
    .prepare('SELECT * FROM saved_filters ORDER BY pinned DESC, sort_order ASC, created_at ASC')
    .all() as Record<string, unknown>[]
  return rows.map(mapSavedFilter)
}

export function getSavedFilter(id: string): SavedFilter | null {
  const row = conn().prepare('SELECT * FROM saved_filters WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  return row ? mapSavedFilter(row) : null
}

export function createSavedFilter(input: {
  name: string
  query: FilterQuery
  color?: string | null
}): SavedFilter {
  const clean = input.name.trim()
  if (!clean) throw new Error('过滤器名称不能为空')
  const id = randomUUID()
  const now = nowIso()
  const max = conn().prepare('SELECT MAX(sort_order) AS m FROM saved_filters').get() as {
    m: number | null
  }
  const order = (max.m ?? 0) + 1024
  conn()
    .prepare(
      'INSERT INTO saved_filters (id,name,query_json,color,pinned,sort_order,created_at) VALUES (?,?,?,?,0,?,?)'
    )
    .run(id, clean, JSON.stringify(input.query), input.color ?? null, order, now)
  return {
    id,
    name: clean,
    query: input.query,
    color: input.color ?? null,
    pinned: 0,
    sortOrder: order,
    createdAt: now
  }
}

export function updateSavedFilter(
  id: string,
  patch: { name?: string; query?: FilterQuery; color?: string | null; pinned?: number }
): SavedFilter {
  const fields: string[] = []
  const params: unknown[] = []
  if (patch.name !== undefined) {
    const clean = patch.name.trim()
    if (!clean) throw new Error('过滤器名称不能为空')
    fields.push('name = ?')
    params.push(clean)
  }
  if (patch.query !== undefined) {
    fields.push('query_json = ?')
    params.push(JSON.stringify(patch.query))
  }
  if (patch.color !== undefined) {
    fields.push('color = ?')
    params.push(patch.color)
  }
  if (patch.pinned !== undefined) {
    fields.push('pinned = ?')
    params.push(patch.pinned ? 1 : 0)
  }
  if (fields.length) {
    params.push(id)
    conn().prepare(`UPDATE saved_filters SET ${fields.join(', ')} WHERE id = ?`).run(...(params as never[]))
  }
  return getSavedFilter(id)!
}

export function deleteSavedFilter(id: string): void {
  conn().prepare('DELETE FROM saved_filters WHERE id = ?').run(id)
}

function filterContext(now: Date): {
  today: string
  tomorrow: string
  weekEnd: string
  nowIso: string
} {
  const dow = now.getDay()
  return {
    today: dayStr(now),
    tomorrow: dayStr(addDays(now, 1)),
    weekEnd: dayStr(addDays(now, dow === 0 ? 0 : 7 - dow)),
    nowIso: now.toISOString()
  }
}

export function countFilter(query: FilterQuery): number {
  const built = buildFilterSql(query, filterContext(new Date()))
  const row = conn()
    .prepare(
      `SELECT COUNT(*) AS count FROM tasks t
       WHERE t.deleted_at IS NULL AND t.parent_id IS NULL
         AND ${queryHasField(query, 'status') ? '' : 't.status = 0 AND '}${built.sql}`
    )
    .get(...(built.params as never[])) as { count: number | null }
  return Number(row.count ?? 0)
}

// ─────────────────────────────────────────────────────────────
// 每日收尾 / 关机仪式
// ─────────────────────────────────────────────────────────────

function mapDayReview(row: Record<string, unknown>): DayReview {
  return {
    date: row.date as string,
    rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
    note: (row.note as string) ?? '',
    reviewedAt: row.reviewed_at as string
  }
}

export function getDayReview(date: string): DayReview | null {
  const row = conn().prepare('SELECT * FROM day_reviews WHERE date = ?').get(date) as
    | Record<string, unknown>
    | undefined
  return row ? mapDayReview(row) : null
}

export function saveDayReview(date: string, rating: number | null, note: string): DayReview {
  const reviewedAt = nowIso()
  conn()
    .prepare(
      `INSERT INTO day_reviews (date,rating,note,reviewed_at) VALUES (?,?,?,?)
       ON CONFLICT(date) DO UPDATE SET rating = excluded.rating, note = excluded.note, reviewed_at = excluded.reviewed_at`
    )
    .run(date, rating, note ?? '', reviewedAt)
  return { date, rating, note: note ?? '', reviewedAt }
}

export function getReviewedDates(from: string, to: string): string[] {
  const rows = conn()
    .prepare('SELECT date FROM day_reviews WHERE date BETWEEN ? AND ? ORDER BY date ASC')
    .all(from, to) as { date: string }[]
  return rows.map((row) => row.date)
}

export function shouldPromptShutdown(now = new Date()): boolean {
  if (getSetting('shutdown_enabled') === '0') return false
  const today = dayStr(now)
  if (getDayReview(today)) return false
  const time = getSetting('shutdown_time') ?? '17:30'
  const [h, m] = time.split(':').map(Number)
  const target = new Date(now)
  target.setHours(Number.isFinite(h) ? h : 17, Number.isFinite(m) ? m : 30, 0, 0)
  return now.getTime() >= target.getTime()
}

// ─────────────────────────────────────────────────────────────
// 过期任务 Replan
// ─────────────────────────────────────────────────────────────

export function listOverdueTasks(now = new Date()): Task[] {
  const today = dayStr(now)
  const rows = conn()
    .prepare(
      `SELECT t.*, ${TAGS_SUBQUERY}, ${SUBTASK_COUNTS} FROM tasks t
       WHERE t.deleted_at IS NULL AND t.parent_id IS NULL AND t.status = 0 AND t.someday = 0
         AND ((t.scheduled_date IS NOT NULL AND t.scheduled_date < ?)
           OR (t.due_at IS NOT NULL AND t.due_at < ?))
       ORDER BY COALESCE(t.scheduled_date, '') ASC, t.priority DESC, t.sort_order ASC
       LIMIT 200`
    )
    .all(today, now.toISOString()) as Record<string, unknown>[]
  return rows.map(mapTask)
}

export type ReplanAction = 'complete' | 'today' | 'tomorrow' | 'date' | 'someday'

export function replanTask(id: string, action: ReplanAction, date?: string | null): Task | null {
  const now = new Date()
  const today = dayStr(now)
  switch (action) {
    case 'complete':
      setTaskStatus(id, true)
      break
    case 'today':
      updateTask(id, { scheduledDate: today, someday: false })
      break
    case 'tomorrow':
      updateTask(id, { scheduledDate: dayStr(addDays(now, 1)), someday: false })
      break
    case 'date':
      if (!date) throw new Error('请选择日期')
      assertDateField(date, '计划日期', true)
      updateTask(id, { scheduledDate: date, someday: false })
      break
    case 'someday':
      updateTask(id, { someday: true, scheduledDate: null, dueAt: null })
      break
  }
  conn()
    .prepare('INSERT INTO replan_log (id,date,task_id,action,created_at) VALUES (?,?,?,?,?)')
    .run(randomUUID(), today, id, action, nowIso())
  return getTask(id)
}

export function countReplanActions(date: string): number {
  const row = conn()
    .prepare('SELECT COUNT(*) AS count FROM replan_log WHERE date = ?')
    .get(date) as { count: number | null }
  return Number(row.count ?? 0)
}

// ─────────────────────────────────────────────────────────────
// 实际用时
// ─────────────────────────────────────────────────────────────

export function addTimeEntry(taskId: string, startedAt: string, endedAt: string): Task {
  const start = new Date(startedAt).getTime()
  const end = new Date(endedAt).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error('计时区间无效')
  }
  const minutes = Math.max(1, Math.round((end - start) / 60000))
  transaction(() => {
    conn()
      .prepare(
        'INSERT INTO time_entries (id,task_id,started_at,ended_at,minutes,created_at) VALUES (?,?,?,?,?,?)'
      )
      .run(randomUUID(), taskId, new Date(start).toISOString(), new Date(end).toISOString(), minutes, nowIso())
    conn()
      .prepare('UPDATE tasks SET actual_min = COALESCE(actual_min, 0) + ?, updated_at = ? WHERE id = ?')
      .run(minutes, nowIso(), taskId)
  })
  return getTask(taskId)!
}
