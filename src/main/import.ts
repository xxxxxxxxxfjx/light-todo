import { createFolder, getFolders, createTag, createList, createTask, getLists, getTags, restoreTaskMetadata, restoreOccurrenceLink, setTaskStatus, transaction } from './db.ts'
import type { Task, List, Folder, Tag } from '../shared/types'

export interface ImportResult {
  ok: boolean
  lists: number
  tasks: number
  tags: number
  errors: string[]
  message?: string
}

interface TaskDraft {
  title: string
  notes?: string
  listName?: string | null
  priority?: number
  scheduledDate?: string | null
  dueAt?: string | null
  done?: boolean
  tagNames?: string[]
  parentTitle?: string | null
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      cur.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      cur.push(field)
      field = ''
      if (cur.some((f) => f.trim() !== '')) rows.push(cur)
      cur = []
    } else {
      field += c
    }
  }
  if (field !== '' || cur.length) {
    cur.push(field)
    if (cur.some((f) => f.trim() !== '')) rows.push(cur)
  }
  return rows
}

function toDate(s: string | undefined): string | null {
  if (!s) return null
  const t = s.trim()
  if (!t) return null
  const m = t.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/)
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  }
  return null
}

function toDateTime(s: string | undefined): string | null {
  if (!s) return null
  const t = s.trim()
  if (!t) return null
  const m = t.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})[日号]?\s*(\d{1,2})[:：](\d{2})/)
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))
    return isNaN(d.getTime()) ? null : d.toISOString()
  }
  return null
}

function cnPriority(s: string | undefined): number {
  if (!s) return 0
  if (/高|highest|high/i.test(s)) return 3
  if (/中|medium/i.test(s)) return 2
  if (/低|low/i.test(s)) return 1
  return 0
}

function ticktick(rows: string[][]): TaskDraft[] {
  const headers = rows[0].map((h) => h.trim())
  const col = (name: string): number => headers.indexOf(name)
  const idx = {
    title: col('标题'),
    list: col('清单'),
    tags: col('标签'),
    priority: col('优先级'),
    due: col('截止日期'),
    sub: col('子任务'),
    notes: col('备注'),
    status: col('完成状态')
  }
  const out: TaskDraft[] = []
  for (const r of rows.slice(1)) {
    const title = (r[idx.title] ?? '').trim()
    if (!title) continue
    const tagsRaw = (r[idx.tags] ?? '').trim()
    const doneRaw = (r[idx.status] ?? '').trim()
    out.push({
      title,
      listName: (r[idx.list] ?? '').trim() || null,
      tagNames: tagsRaw ? tagsRaw.split(/[,，、\s]+/).filter(Boolean) : [],
      priority: cnPriority(r[idx.priority]),
      scheduledDate: toDate(r[idx.due]),
      dueAt: toDateTime(r[idx.due]),
      notes: r[idx.notes] ?? '',
      done: /^(1|是|已完成|完成|true)$/i.test(doneRaw)
    })
  }
  return out
}

function todoist(rows: string[][]): TaskDraft[] {
  const headers = rows[0].map((h) => h.trim().toUpperCase())
  const col = (name: string): number => headers.indexOf(name)
  const idx = {
    type: col('TYPE'),
    content: col('CONTENT'),
    priority: col('PRIORITY'),
    indent: col('INDENT'),
    date: col('DATE')
  }
  const out: TaskDraft[] = []
  let lastTop: TaskDraft | null = null
  for (const r of rows.slice(1)) {
    if ((r[idx.type] ?? '').trim().toLowerCase() !== 'task') {
      if ((r[idx.type] ?? '').trim().toLowerCase() === 'section') lastTop = null
      continue
    }
    const title = (r[idx.content] ?? '').trim()
    if (!title) continue
    const p = Number(r[idx.priority] ?? 4)
    const draft: TaskDraft = {
      title,
      priority: p === 1 ? 3 : p === 2 ? 2 : p === 3 ? 1 : 0,
      scheduledDate: toDate(r[idx.date]),
      dueAt: toDateTime(r[idx.date])
    }
    const indent = Number(r[idx.indent] ?? 1)
    if (indent > 1 && lastTop) draft.parentTitle = lastTop.title
    else lastTop = draft
    out.push(draft)
  }
  return out
}

function generic(rows: string[][]): TaskDraft[] {
  const start = rows[0] && rows[0][0] && /title|标题/i.test(rows[0][0]) ? 1 : 0
  return rows
    .slice(start)
    .map((r) => ({ title: (r[0] ?? '').trim(), notes: (r[1] ?? '').trim() }))
    .filter((t) => t.title)
}

function performImport(content: string, filename: string): ImportResult {
  const errors: string[] = []
  const isJson = filename.toLowerCase().endsWith('.json') || content.trim().startsWith('{')
  const result: ImportResult = { ok: false, lists: 0, tasks: 0, tags: 0, errors }

  try {
    if (isJson) {
      const data = JSON.parse(content) as { folders?: Folder[]; lists?: List[]; tags?: Tag[]; tasks?: Task[] }
      if (!data || !Array.isArray(data.tasks)) throw new Error('JSON 必须包含 tasks 数组')
      for (const t of data.tasks) {
        if (typeof t.title !== 'string' || !t.title.trim()) throw new Error('任务标题不能为空')
      }
      const folderIds = new Map<string, string>()
      for (const f of data.folders ?? []) {
        const folder = getFolders().find(x => x.name === f.name) ?? createFolder(f.name)
        folderIds.set(f.id, folder.id)
      }
      const listIdByName = new Map<string, string>()
      const listIds = new Map<string, string>()
      for (const l of getLists()) listIdByName.set(l.name, l.id)
      for (const l of data.lists ?? []) {
        if (!listIdByName.has(l.name)) {
          const created = createList({
            name: l.name,
            color: l.color ?? undefined,
            icon: l.icon ?? undefined,
            folderId: l.folderId ? folderIds.get(l.folderId) ?? null : null
          })
          listIdByName.set(l.name, created.id)
          result.lists++
        }
        if (l.id) listIds.set(l.id, listIdByName.get(l.name)!)
      }
      for (const tag of data.tags ?? []) createTag(tag.name, tag.color ?? undefined)
      const taskIds = new Map<string, string>()
      let pending = [...data.tasks]
      while (pending.length) {
        const ready = pending.filter(t => !t.parentId || taskIds.has(t.parentId))
        if (!ready.length) throw new Error('子任务的父任务不存在或存在循环引用')
        for (const t of ready) {
        const created = createTask({
          title: t.title,
          notes: t.notes ?? '',
          listId: t.listId ? (listIds.get(t.listId) ?? listIdByName.get(t.listId) ?? null) : null,
          parentId: t.parentId ? taskIds.get(t.parentId) : null,
          priority: t.priority ?? 0,
          someday: t.someday ?? (!t.scheduledDate && !t.dueAt),
          scheduledDate: t.scheduledDate ?? null,
          dueAt: t.dueAt ?? null,
          dueAllDay: t.dueAllDay ?? 0,
          rrule: t.rrule ?? null,
          repeatFrom: t.repeatFrom ?? null,
          reminderAt: t.reminderAt ?? null,
          reminderOffset: t.reminderOffset ?? null,
          tagNames: (t.tags ?? []).map((x) => x.name)
        })
        restoreTaskMetadata(created.id, t)
        if (t.id) taskIds.set(t.id, created.id)
        result.tasks++
        }
        pending = pending.filter(t => !ready.includes(t))
      }
      result.tags = (data.tags ?? []).length
      for (const t of data.tasks) {
        if (t.id && t.nextOccurrenceId && taskIds.has(t.nextOccurrenceId)) restoreOccurrenceLink(taskIds.get(t.id)!, taskIds.get(t.nextOccurrenceId)!)
      }
      result.ok = true
      return result
    }

    const rows = parseCsv(content)
    if (rows.length < 2) {
      result.message = '没有可导入的数据行'
      return result
    }
    const headers = rows[0].map((h) => h.trim().toLowerCase())
    let drafts: TaskDraft[]
    if (headers.includes('标题')) drafts = ticktick(rows)
    else if (headers.includes('content') && headers.includes('type')) drafts = todoist(rows)
    else drafts = generic(rows)

    const listIdByName = new Map<string, string>()
    for (const l of getLists()) listIdByName.set(l.name, l.id)
    const taskIdByTitle = new Map<string, string>()

    for (const d of drafts) {
      let listId: string | null = null
      if (d.listName) {
        if (!listIdByName.has(d.listName)) {
          const created = createList({ name: d.listName })
          listIdByName.set(d.listName, created.id)
          result.lists++
        }
        listId = listIdByName.get(d.listName)!
      }
      let parentId: string | null = null
      if (d.parentTitle) parentId = taskIdByTitle.get(d.parentTitle) ?? null
      const created = createTask({
        title: d.title,
        notes: d.notes ?? '',
        listId,
        parentId,
        priority: d.priority ?? 0,
        scheduledDate: d.scheduledDate ?? null,
        dueAt: d.dueAt ?? null,
        tagNames: d.tagNames ?? []
      })
      taskIdByTitle.set(d.title, created.id)
      if (d.done) setTaskStatus(created.id, true)
      result.tasks++
    }
    result.tags = getTags().length
    result.ok = true
    return result
  } catch (e) {
    throw e
  }
}

export function importFromText(content: string, filename: string): ImportResult {
  try {
    return transaction(() => performImport(content, filename))
  } catch (e) {
    return { ok: false, lists: 0, tasks: 0, tags: 0, errors: [String(e)], message: String(e) }
  }
}

// imported by data.ts and test scripts
