import type { FilterCondition, FilterOp, FilterQuery, List, Tag } from './types'

export const FILTER_FIELDS: { value: FilterCondition['field']; label: string }[] = [
  { value: 'scheduled', label: '计划日' },
  { value: 'due', label: '截止日' },
  { value: 'priority', label: '优先级' },
  { value: 'list', label: '清单' },
  { value: 'tag', label: '标签' },
  { value: 'status', label: '完成状态' },
  { value: 'someday', label: '也许' },
  { value: 'text', label: '标题/备注' },
  { value: 'overdue', label: '是否逾期' },
  { value: 'nodate', label: '是否无日期' }
]

export const FILTER_OPS: Record<FilterCondition['field'], { value: FilterOp; label: string }[]> = {
  scheduled: [
    { value: 'is', label: '是' },
    { value: 'before', label: '早于' },
    { value: 'after', label: '晚于' },
    { value: 'empty', label: '为空' },
    { value: 'notEmpty', label: '不为空' }
  ],
  due: [
    { value: 'is', label: '是' },
    { value: 'before', label: '早于' },
    { value: 'after', label: '晚于' },
    { value: 'empty', label: '为空' },
    { value: 'notEmpty', label: '不为空' }
  ],
  priority: [
    { value: 'is', label: '等于' },
    { value: 'gte', label: '大于等于' },
    { value: 'lte', label: '小于等于' }
  ],
  list: [
    { value: 'is', label: '是' },
    { value: 'isNot', label: '不是' }
  ],
  tag: [
    { value: 'is', label: '有标签' },
    { value: 'isNot', label: '没有标签' }
  ],
  status: [{ value: 'is', label: '是' }],
  someday: [{ value: 'is', label: '是' }],
  text: [{ value: 'contains', label: '包含' }],
  overdue: [{ value: 'is', label: '是' }],
  nodate: [{ value: 'is', label: '是' }]
}

export const PRIORITY_OPTIONS = [
  { value: '0', label: '无' },
  { value: '1', label: '低' },
  { value: '2', label: '中' },
  { value: '3', label: '高' }
]

export const DATE_PRESETS = [
  { value: 'today', label: '今天' },
  { value: 'tomorrow', label: '明天' },
  { value: 'week', label: '本周内' }
]

export function emptyFilterQuery(): FilterQuery {
  return { match: 'all', conditions: [] }
}

export function queryHasField(query: FilterQuery, field: FilterCondition['field']): boolean {
  return query.conditions.some((condition) => condition.field === field)
}

export interface FilterSqlContext {
  today: string
  tomorrow: string
  weekEnd: string
  nowIso: string
}

export interface BuiltFilter {
  sql: string
  params: unknown[]
}

function likeTerm(raw: string): string {
  return `%${raw.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
}

function dateCondition(
  column: string,
  op: FilterOp,
  value: string,
  ctx: FilterSqlContext
): BuiltFilter | null {
  if (op === 'empty') return { sql: `${column} IS NULL`, params: [] }
  if (op === 'notEmpty') return { sql: `${column} IS NOT NULL`, params: [] }
  if (value === 'week') {
    return {
      sql: `date(${column}, 'localtime') BETWEEN ? AND ?`,
      params: [ctx.today, ctx.weekEnd]
    }
  }
  let target = value
  if (value === 'today') target = ctx.today
  else if (value === 'tomorrow') target = ctx.tomorrow
  if (op === 'is') {
    return { sql: `date(${column}, 'localtime') = ?`, params: [target] }
  }
  if (op === 'before') {
    return { sql: `date(${column}, 'localtime') < ?`, params: [target] }
  }
  if (op === 'after') {
    return { sql: `date(${column}, 'localtime') > ?`, params: [target] }
  }
  return null
}

/** Build a parameterised SQL fragment for one saved filter. */
export function buildFilterSql(query: FilterQuery, ctx: FilterSqlContext): BuiltFilter {
  const parts: BuiltFilter[] = []
  for (const condition of query.conditions) {
    const built = buildCondition(condition, ctx)
    if (built) parts.push(built)
  }
  if (!parts.length) return { sql: '1=1', params: [] }
  const joiner = query.match === 'any' ? ' OR ' : ' AND '
  return {
    sql: `(${parts.map((part) => `(${part.sql})`).join(joiner)})`,
    params: parts.flatMap((part) => part.params)
  }
}

function buildCondition(condition: FilterCondition, ctx: FilterSqlContext): BuiltFilter | null {
  const { field, op, value } = condition
  switch (field) {
    case 'priority': {
      const n = Number(value)
      if (!Number.isFinite(n)) return null
      if (op === 'gte') return { sql: 't.priority >= ?', params: [n] }
      if (op === 'lte') return { sql: 't.priority <= ?', params: [n] }
      return { sql: 't.priority = ?', params: [n] }
    }
    case 'list':
      if (value === 'none') {
        return { sql: op === 'isNot' ? 't.list_id IS NOT NULL' : 't.list_id IS NULL', params: [] }
      }
      return {
        sql: op === 'isNot' ? 't.list_id IS NOT ?' : 't.list_id = ?',
        params: [value]
      }
    case 'tag':
      return {
        sql:
          op === 'isNot'
            ? 't.id NOT IN (SELECT task_id FROM task_tags WHERE tag_id = ?)'
            : 't.id IN (SELECT task_id FROM task_tags WHERE tag_id = ?)',
        params: [value]
      }
    case 'status':
      return { sql: `t.status = ${value === 'done' ? 1 : 0}`, params: [] }
    case 'someday':
      return { sql: `t.someday = ${value === 'no' ? 0 : 1}`, params: [] }
    case 'text':
      if (!value.trim()) return null
      return {
        sql: `(t.title LIKE ? ESCAPE '\\' OR t.notes LIKE ? ESCAPE '\\')`,
        params: [likeTerm(value.trim()), likeTerm(value.trim())]
      }
    case 'overdue':
      return {
        sql:
          '((t.scheduled_date IS NOT NULL AND t.scheduled_date < ?) OR (t.due_at IS NOT NULL AND t.due_at < ?))',
        params: [ctx.today, ctx.nowIso]
      }
    case 'nodate':
      return { sql: 't.scheduled_date IS NULL AND t.due_at IS NULL', params: [] }
    case 'scheduled':
      return dateCondition('t.scheduled_date', op, value, ctx)
    case 'due':
      return dateCondition('t.due_at', op, value, ctx)
    default:
      return null
  }
}

/** Human-readable one-line summary used in the sidebar / editor preview. */
export function filterSummary(query: FilterQuery, lists: List[], tags: Tag[]): string {
  if (!query.conditions.length) return '全部未完成任务'
  const join = query.match === 'any' ? ' 或 ' : ' 且 '
  return query.conditions
    .map((condition) => {
      const field = FILTER_FIELDS.find((item) => item.value === condition.field)?.label ?? condition.field
      const op = FILTER_OPS[condition.field]?.find((item) => item.value === condition.op)?.label ?? ''
      let value = condition.value
      if (condition.field === 'list') {
        value = condition.value === 'none' ? '未分类' : lists.find((l) => l.id === condition.value)?.name ?? '清单'
      } else if (condition.field === 'tag') {
        value = tags.find((t) => t.id === condition.value)?.name ?? '标签'
      } else if (condition.field === 'priority') {
        value = PRIORITY_OPTIONS.find((item) => item.value === condition.value)?.label ?? value
      } else if (condition.field === 'scheduled' || condition.field === 'due') {
        value = DATE_PRESETS.find((item) => item.value === condition.value)?.label ?? value
      } else if (condition.field === 'status') {
        value = condition.value === 'done' ? '已完成' : '未完成'
      } else if (condition.field === 'someday') {
        value = condition.value === 'no' ? '否' : '是'
      }
      if (condition.field === 'overdue' || condition.field === 'nodate') return `${field}`
      return `${field}${op}${value ? ` ${value}` : ''}`
    })
    .join(join)
}

export interface ParsedFilterText {
  query: FilterQuery
  used: string[]
  unresolved: string[]
}

/**
 * Small deterministic Chinese parser for “一句话建过滤器”.
 * It intentionally only understands a documented vocabulary; anything else is
 * returned in `unresolved` so the UI can ask the user to add it manually.
 */
export function parseFilterText(text: string, lists: List[], tags: Tag[]): ParsedFilterText {
  const conditions: FilterCondition[] = []
  const used: string[] = []
  const unresolved: string[] = []
  const source = text.trim()
  if (!source) return { query: emptyFilterQuery(), used, unresolved }

  const push = (condition: FilterCondition, token: string): void => {
    if (!conditions.some((c) => c.field === condition.field && c.op === condition.op && c.value === condition.value)) {
      conditions.push(condition)
    }
    used.push(token)
  }

  if (/逾期/.test(source)) push({ field: 'overdue', op: 'is', value: '' }, '逾期')
  if (/无日期|没有日期/.test(source)) push({ field: 'nodate', op: 'is', value: '' }, '无日期')
  if (/今天|今日/.test(source)) push({ field: 'scheduled', op: 'is', value: 'today' }, '今天')
  else if (/明天|明日/.test(source)) push({ field: 'scheduled', op: 'is', value: 'tomorrow' }, '明天')
  else if (/本周|这周/.test(source)) push({ field: 'scheduled', op: 'is', value: 'week' }, '本周')

  if (/高优先级|重要/.test(source)) push({ field: 'priority', op: 'gte', value: '3' }, '高优先级')
  else if (/中优先级/.test(source)) push({ field: 'priority', op: 'is', value: '2' }, '中优先级')
  else if (/低优先级/.test(source)) push({ field: 'priority', op: 'is', value: '1' }, '低优先级')

  if (/已完成/.test(source)) push({ field: 'status', op: 'is', value: 'done' }, '已完成')

  for (const match of source.matchAll(/#([^\s#@*，,、]+)/g)) {
    const name = match[1]
    const list = lists.find((item) => item.name === name)
    if (list) push({ field: 'list', op: 'is', value: list.id }, `#${name}`)
    else unresolved.push(`#${name}`)
  }
  for (const match of source.matchAll(/@([^\s#@*，,、]+)/g)) {
    const name = match[1]
    const tag = tags.find((item) => item.name === name)
    if (tag) push({ field: 'tag', op: 'is', value: tag.id }, `@${name}`)
    else unresolved.push(`@${name}`)
  }

  const quoted = /(?:包含|含有|含)[「“"']([^」”"']+)[」”"']/.exec(source)
  if (quoted) push({ field: 'text', op: 'contains', value: quoted[1] }, `包含「${quoted[1]}」`)

  return { query: { match: 'all', conditions }, used, unresolved }
}
