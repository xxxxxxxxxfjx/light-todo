import type { Folder, List, Tag, Task } from '../shared/types'

export interface ExportData {
  exportedAt?: string
  folders: Folder[]
  lists: List[]
  tags: Tag[]
  tasks: Task[]
}

/** Render the full local database as readable Markdown, preserving notes and
 *  arbitrarily deep subtasks. */
export function buildMarkdown(data: ExportData): string {
  const lines: string[] = [`# 轻单导出 ${new Date().toLocaleString('zh-CN')}`, '']
  const byId = new Map(data.tasks.map((t) => [t.id, t]))
  const children = new Map<string, Task[]>()
  for (const t of data.tasks) {
    if (!t.parentId) continue
    if (!children.has(t.parentId)) children.set(t.parentId, [])
    children.get(t.parentId)!.push(t)
  }
  const byList = new Map<string, Task[]>()
  for (const t of data.tasks) {
    if (t.parentId && byId.has(t.parentId)) continue
    const key = t.listId ?? ''
    if (!byList.has(key)) byList.set(key, [])
    byList.get(key)!.push(t)
  }
  const listName = (id: string): string => data.lists.find((l) => l.id === id)?.name ?? '未分类'
  const writeTask = (t: Task, depth: number): void => {
    const indent = '  '.repeat(depth)
    const done = t.status === 1 ? 'x' : ' '
    const bits: string[] = []
    if (t.scheduledDate) bits.push(`计划 ${t.scheduledDate}`)
    if (t.dueAt) bits.push(`截止 ${new Date(t.dueAt).toLocaleString('zh-CN')}`)
    if (t.priority === 3) bits.push('!高')
    else if (t.priority === 2) bits.push('!中')
    else if (t.priority === 1) bits.push('!低')
    if (t.tags.length) bits.push(t.tags.map((x) => `#${x.name}`).join(' '))
    lines.push(
      `${indent}- [${done}] ${t.title}${bits.length ? `  _(${bits.join(' · ')})_` : ''}`
    )
    const notes = (t.notes ?? '').trim()
    if (notes) {
      for (const line of notes.split(/\r?\n/)) lines.push(`${indent}  ${line}`)
    }
    for (const sub of children.get(t.id) ?? []) writeTask(sub, depth + 1)
  }
  for (const [listId, tasks] of byList) {
    lines.push(`## ${listId ? listName(listId) : '未分类'}`, '')
    for (const t of tasks) writeTask(t, 0)
    lines.push('')
  }
  return lines.join('\n')
}
