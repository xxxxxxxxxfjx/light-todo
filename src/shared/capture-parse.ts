import { addDays, format } from 'date-fns'
import { parseQuickAdd } from './nlp.ts'

export interface ParsedCapture {
  title: string
  scheduledDate: string | null
  dueAt: string | null
  dueAllDay: number
  estimateMin: number | null
}

const FULLWIDTH_DIGITS = /[０-９]/g

/** OCR often emits full-width punctuation and spaces between glyphs/digits. */
export function normalizeCaptureText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(FULLWIDTH_DIGITS, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[：]/g, ':')
    .replace(/[．]/g, '.')
    .replace(/[－—–~～]/g, '-')
    .replace(/(?<=\d)\s*[.·•]\s*(?=\d)/g, '-')
    .replace(/(?<=\d)\s*[·•]\s*(?=\d)/g, '-')
    .replace(/(?<=\d)\s+(?=\d)/g, '')
    .replace(/(?<=[年月日号])\s+(?=\d)/g, '')
    .replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '')
    .replace(/(?<=\d)\s+(?=[:.\-/月日号点时分])/g, '')
    .replace(/(?<=[:.\-/])\s+(?=\d)/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function localDate(now: Date): string {
  return format(now, 'yyyy-MM-dd')
}

function atTime(dateKey: string, hour: number, minute: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString()
}

function cleanTitle(value: string, extras: string[]): string {
  let title = value
  for (const extra of extras) {
    if (extra) title = title.split(extra).join(' ')
  }
  title = title
    .replace(/\s+/g, ' ')
    .replace(/^[\s,，、;；:：\-.]+|[\s,，、;；:：\-.]+$/g, '')
    .replace(/(?<=[\u3400-\u9fff])[a-zA-Z]$/g, '')
    .trim()
  // Small OCR confusion table for the words that show up most in task capture.
  const fixes: [RegExp, string][] = [
    [/顶目/g, '项目'],
    [/会仪/g, '会议'],
    [/周抱/g, '周报'],
    [/任努/g, '任务'],
    [/椤圭洰/g, '项目']
  ]
  for (const [pattern, replacement] of fixes) title = title.replace(pattern, replacement)
  return title
}

/**
 * Turn a block of OCR text into task fields.
 *
 * 1. Prefer the line that actually contains a date or a clock time.
 * 2. Use the existing Chinese NLP for date words (“明天”, “11月13日”).
 * 3. Pull out “10:00-11:30” separately so the duration becomes 估时.
 * 4. Everything left over becomes the title; the full text stays in 备注.
 */
export function parseCaptureText(raw: string, now: Date = new Date()): ParsedCapture {
  const normalized = normalizeCaptureText(raw)
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const primary =
    lines.find((line) => /\d{1,2}:\d{2}|[月日号]|今天|明天|后天/.test(line)) ?? lines[0] ?? ''
  const parsed = parseQuickAdd(primary, now)

  const rangeMatch = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/.exec(normalized)
  const singleTime = /(\d{1,2}):(\d{2})/.exec(normalized)
  const extras: string[] = []
  if (rangeMatch) extras.push(rangeMatch[0])
  if (singleTime) extras.push(singleTime[0])

  let scheduledDate = parsed.scheduledDate
  let dueAt = parsed.dueAt
  let dueAllDay = parsed.dueAllDay
  let estimateMin = parsed.estimateMin

  if (rangeMatch) {
    const startHour = Number(rangeMatch[1])
    const startMinute = Number(rangeMatch[2])
    const endHour = Number(rangeMatch[3])
    const endMinute = Number(rangeMatch[4])
    let start = startHour
    let end = endHour
    if (end < start && end < 12) end += 12
    let dateKey = scheduledDate ?? localDate(now)
    if (!scheduledDate) {
      const candidate = atTime(dateKey, start, startMinute)
      if (new Date(candidate).getTime() < now.getTime()) dateKey = format(addDays(now, 1), 'yyyy-MM-dd')
    }
    scheduledDate = dateKey
    dueAt = atTime(dateKey, start, startMinute)
    dueAllDay = 0
    const duration = (end - start) * 60 + (endMinute - startMinute)
    if (duration > 0) estimateMin = duration
  } else if (singleTime && !dueAt) {
    const hour = Number(singleTime[1])
    const minute = Number(singleTime[2])
    const dateKey = scheduledDate ?? localDate(now)
    scheduledDate = dateKey
    dueAt = atTime(dateKey, hour, minute)
    dueAllDay = 0
  }

  let title = cleanTitle(parsed.title, extras)
  if (!title) {
    title = cleanTitle(
      lines.find((line) => line !== primary) ?? '',
      extras
    )
  }
  if (!title) title = '截图任务'

  return {
    title,
    scheduledDate,
    dueAt,
    dueAllDay,
    estimateMin
  }
}
