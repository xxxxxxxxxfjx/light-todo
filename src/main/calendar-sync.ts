import {
  markCalendarSubscriptionSynced,
  replaceCalendarEvents,
  saveCalendarSubscription,
  setCalendarSubscriptionError
} from './db'

/**
 * 只读 ICS 订阅（90 天路线第 4 阶段）。
 *
 * 范围与限制：
 * - 只读取首个 DTSTART 实例，RRULE 原样保存但不展开；
 * - 支持 DATE / 本地 floating DATE-TIME / UTC DATE-TIME；
 * - TZID 参数不做时区换算（按本地 floating 时间处理），未引入时区数据库；
 * - 不支持 RECURRENCE-ID 覆盖实例、EXDATE、VALARM、附件等高级语义。
 *
 * 本模块只负责“拉取 -> 解析 -> 本地快照”，没有任何向外写回日历的路径。
 */

export interface ParsedCalendarEvent {
  uid: string | null
  title: string
  description: string | null
  startAt: string
  endAt: string | null
  allDay: boolean
  rrule: string | null
}

export interface IcsSyncResult {
  url: string
  count: number
  name?: string
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const MAX_ICS_BYTES = 5 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15_000
const SUBSCRIPTION_ID = '1'

interface IcsProperty {
  name: string
  params: Record<string, string>
  value: string
}

interface EventDraft {
  uid: string | null
  summary: string | null
  description: string | null
  dtstart: string | null
  dtstartValueType: string | null
  dtend: string | null
  dtendValueType: string | null
  rrule: string | null
}

function unfoldIcsLines(text: string): string[] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const physical = normalized.split('\n')
  const lines: string[] = []
  for (const line of physical) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1)
    } else {
      lines.push(line)
    }
  }
  return lines
}

function splitProperty(line: string): IcsProperty | null {
  const colon = line.indexOf(':')
  if (colon <= 0) return null
  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const parts = head.split(';')
  let name = (parts.shift() ?? '').trim().toUpperCase()
  if (!name) return null
  // 兼容少数客户端输出的 group 前缀（例如 item1.SUMMARY）。
  if (name.includes('.')) name = name.slice(name.lastIndexOf('.') + 1)
  if (!/^[A-Z0-9-]+$/.test(name)) return null
  const params: Record<string, string> = {}
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const key = part.slice(0, eq).trim().toUpperCase()
    if (!key) continue
    let paramValue = part.slice(eq + 1).trim()
    if (paramValue.startsWith('"') && paramValue.endsWith('"')) {
      paramValue = paramValue.slice(1, -1)
    }
    params[key] = paramValue
  }
  return { name, params, value }
}

function unescapeIcsText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_match, escaped: string) => {
    if (escaped === 'n' || escaped === 'N') return '\n'
    return escaped
  })
}

function parseIcsDate(
  raw: string,
  valueType: string | null
): { date: Date; allDay: boolean } | null {
  const value = raw.trim()
  if (!value) return null
  const isDate = valueType === 'DATE' || /^\d{8}$/.test(value)
  if (isDate) {
    const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value)
    if (!match) return null
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const date = new Date(year, month - 1, day, 0, 0, 0, 0)
    if (
      Number.isNaN(date.getTime()) ||
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null
    }
    return { date, allDay: true }
  }

  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/i.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const utc = !!match[7]
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null
  }
  const date = utc
    ? new Date(Date.UTC(year, month - 1, day, hour, minute, second, 0))
    : new Date(year, month - 1, day, hour, minute, second, 0)
  if (Number.isNaN(date.getTime())) return null
  if (utc) {
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day ||
      date.getUTCHours() !== hour ||
      date.getUTCMinutes() !== minute ||
      date.getUTCSeconds() !== second
    ) {
      return null
    }
  } else if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second
  ) {
    return null
  }
  return { date, allDay: false }
}

function finishEvent(draft: EventDraft): ParsedCalendarEvent | null {
  if (!draft.dtstart) return null
  const start = parseIcsDate(draft.dtstart, draft.dtstartValueType)
  if (!start) return null
  let end: Date | null = null
  if (draft.dtend) {
    const parsedEnd = parseIcsDate(draft.dtend, draft.dtendValueType)
    if (!parsedEnd) return null
    end = parsedEnd.date
    if (end.getTime() <= start.date.getTime()) end = null
  }
  if (start.allDay && !end) {
    end = new Date(start.date)
    end.setDate(end.getDate() + 1)
  }
  const title = unescapeIcsText(draft.summary ?? '').trim() || '未命名日程'
  const description = unescapeIcsText(draft.description ?? '').trim()
  return {
    uid: draft.uid ? unescapeIcsText(draft.uid).trim() || null : null,
    title,
    description: description || null,
    startAt: start.date.toISOString(),
    endAt: end ? end.toISOString() : null,
    allDay: start.allDay,
    rrule: draft.rrule?.trim() || null
  }
}

function newDraft(): EventDraft {
  return {
    uid: null,
    summary: null,
    description: null,
    dtstart: null,
    dtstartValueType: null,
    dtend: null,
    dtendValueType: null,
    rrule: null
  }
}

/**
 * 纯函数：把 ICS 文本解析为最小日程模型。
 * 无 DTSTART 或日期无法解析的 VEVENT 会被跳过；VALARM 内的属性不会污染 VEVENT。
 */
export function parseIcs(text: string): ParsedCalendarEvent[] {
  const events: ParsedCalendarEvent[] = []
  let current: EventDraft | null = null
  let inAlarm = false

  for (const line of unfoldIcsLines(text)) {
    const property = splitProperty(line)
    if (!property) continue
    const { name, params, value } = property

    if (name === 'BEGIN' && value.trim().toUpperCase() === 'VEVENT') {
      current = newDraft()
      inAlarm = false
      continue
    }
    if (name === 'END' && value.trim().toUpperCase() === 'VEVENT') {
      if (current) {
        const event = finishEvent(current)
        if (event) events.push(event)
      }
      current = null
      inAlarm = false
      continue
    }
    if (!current) continue
    if (name === 'BEGIN' && value.trim().toUpperCase() === 'VALARM') {
      inAlarm = true
      continue
    }
    if (name === 'END' && value.trim().toUpperCase() === 'VALARM') {
      inAlarm = false
      continue
    }
    if (inAlarm) continue

    switch (name) {
      case 'UID':
        current.uid = value.trim()
        break
      case 'SUMMARY':
        current.summary = value
        break
      case 'DESCRIPTION':
        current.description = value
        break
      case 'DTSTART':
        current.dtstart = value
        current.dtstartValueType = params.VALUE?.toUpperCase() ?? null
        break
      case 'DTEND':
        current.dtend = value
        current.dtendValueType = params.VALUE?.toUpperCase() ?? null
        break
      case 'RRULE':
        current.rrule = value
        break
    }
  }
  return events
}

function calendarNameFromIcs(text: string): string | null {
  for (const line of unfoldIcsLines(text)) {
    const property = splitProperty(line)
    if (!property) continue
    if (property.name === 'X-WR-CALNAME' || property.name === 'NAME') {
      const name = unescapeIcsText(property.value).trim()
      if (name) return name
    }
  }
  return null
}

function normalizeSubscriptionUrl(input: string): string {
  let raw = typeof input === 'string' ? input.trim() : ''
  if (!raw) throw new Error('请输入日历订阅地址')
  if (/^webcal:\/\//i.test(raw)) raw = `https://${raw.slice('webcal://'.length)}`
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('日历订阅地址无效')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('仅支持 http/https（或 webcal）日历订阅地址')
  }
  return parsed.toString()
}

function hasVCalendar(text: string): boolean {
  return unfoldIcsLines(text).some((line) => line.trim().toUpperCase() === 'BEGIN:VCALENDAR')
}

async function readBodyWithLimit(response: Response): Promise<string> {
  const declared = response.headers.get('content-length')
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_ICS_BYTES) {
    throw new Error('日历文件超过 5 MB 限制')
  }
  if (!response.body) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > MAX_ICS_BYTES) {
      throw new Error('日历文件超过 5 MB 限制')
    }
    return text
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > MAX_ICS_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new Error('日历文件超过 5 MB 限制')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8').decode(body)
}

function readableFetchError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return '同步超时（15 秒）'
    return error.message || '日历同步失败'
  }
  return '日历同步失败'
}

/**
 * 拉取并同步一个只读 ICS 订阅。
 * 成功：整体替换本地快照并记录 last_synced_at；失败：记录 last_error 后抛出。
 */
export async function syncIcsSubscription(
  input: string,
  fetchImpl: FetchLike = fetch
): Promise<IcsSyncResult> {
  const url = normalizeSubscriptionUrl(input)
  saveCalendarSubscription(url)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5'
      }
    })
    if (!response.ok) {
      throw new Error(`同步失败：HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`)
    }
    const body = await readBodyWithLimit(response)
    if (!hasVCalendar(body)) throw new Error('不是有效的 ICS 日历（缺少 BEGIN:VCALENDAR）')
    const events = parseIcs(body)
    const name = calendarNameFromIcs(body)
    if (name) saveCalendarSubscription(url, name)
    replaceCalendarEvents(SUBSCRIPTION_ID, events)
    markCalendarSubscriptionSynced()
    return { url, count: events.length, ...(name ? { name } : {}) }
  } catch (error) {
    const message = readableFetchError(error)
    setCalendarSubscriptionError(message)
    throw error instanceof Error ? error : new Error(message)
  } finally {
    clearTimeout(timer)
  }
}
