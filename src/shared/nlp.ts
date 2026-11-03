import {
  addDays,
  addMonths,
  addYears,
  endOfMonth,
  format,
  setDate,
  startOfDay,
  startOfMonth
} from 'date-fns'

export interface ParsedQuickAdd {
  title: string
  scheduledDate: string | null
  dueAt: string | null
  dueAllDay: number
  rrule: string | null
  repeatFrom: 'due' | 'completion' | null
  priority: number
  listName: string | null
  tagNames: string[]
}

const CN_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10
}

function cnToNumber(s: string): number {
  if (/^\d+$/.test(s)) return parseInt(s, 10)
  if (s === '十') return 10
  if (s.startsWith('十')) return 10 + (CN_DIGITS[s.slice(1)] ?? 0)
  if (s.includes('十')) {
    const [a, b] = s.split('十')
    return (CN_DIGITS[a] ?? 0) * 10 + (b ? CN_DIGITS[b] ?? 0 : 0)
  }
  return CN_DIGITS[s] ?? 0
}

const WEEKDAY: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 0,
  天: 0
}

const WEEKDAY_CODE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

function localDate(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

function nextNthWeekday(from: Date, nth: number, weekday: number): Date {
  for (let i = 0; i < 14; i++) {
    const monthStart = new Date(from.getFullYear(), from.getMonth() + i, 1)
    const offset = (weekday - monthStart.getDay() + 7) % 7
    const candidate = new Date(
      monthStart.getFullYear(),
      monthStart.getMonth(),
      1 + offset + (nth - 1) * 7
    )
    if (candidate.getMonth() !== monthStart.getMonth()) continue
    if (candidate.getTime() >= from.getTime()) return candidate
  }
  return from
}

export function parseQuickAdd(input: string, now: Date = new Date()): ParsedQuickAdd {
  let rest = input
  const cut = (start: number, length: number): void => {
    rest = `${rest.slice(0, start)} ${rest.slice(start + length)}`.replace(/\s+/g, ' ')
  }
  const take = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(rest)
    if (!m) return null
    cut(m.index, m[0].length)
    return m
  }

  const tagNames: string[] = []
  for (let i = 0; i < 12; i++) {
    const m = take(/@([^\s@#!]+)/)
    if (!m) break
    tagNames.push(m[1])
  }

  let listName: string | null = null
  const lm = take(/#([^\s@#!]+)/)
  if (lm) listName = lm[1]

  let priority = 0
  const pm = take(/!(高|中|低|[1-4])/)
  if (pm) {
    const v = pm[1]
    if (v === '高' || v === '1') priority = 3
    else if (v === '中' || v === '2') priority = 2
    else if (v === '低' || v === '3') priority = 1
    else priority = 0
  }

  let rrule: string | null = null
  let repeatWeekdays: number[] | null = null
  let repeatMonthDay: number | null = null
  let repeatNthWeekday: { nth: number; wd: number } | null = null
  const anchorDate: Date | null = null

  const weekdayList = (s: string): number[] =>
    [...s.replace(/[,，、和\s]/g, '')]
      .map((x) => WEEKDAY[x])
      .filter((x) => x !== undefined) as number[]

  // 每月第 N 个周X
  let m = take(/每(?:个)?月第([一二三四五1-5])个?(?:周|星期|礼拜)([一二三四五六日天])/)
  if (m) {
    const nth = cnToNumber(m[1])
    const wd = WEEKDAY[m[2]]
    repeatNthWeekday = { nth, wd }
    rrule = `FREQ=MONTHLY;BYDAY=${nth}${WEEKDAY_CODE[wd]}`
  }

  // 每周一/三/五
  if (!rrule) {
    m = take(/每(?:个)?(?:周|星期|礼拜)([一二三四五六日天](?:[,，、和]?[一二三四五六日天])*)/)
    if (m) {
      repeatWeekdays = weekdayList(m[1])
      if (repeatWeekdays.length) {
        rrule = `FREQ=WEEKLY;BYDAY=${repeatWeekdays.map((d) => WEEKDAY_CODE[d]).join(',')}`
      }
    }
  }

  // 每工作日 / 工作日
  if (!rrule) {
    m = take(/(?:每(?:个)?)?工作日/)
    if (m) {
      repeatWeekdays = [1, 2, 3, 4, 5]
      rrule = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
    }
  }

  // 每月 N 号
  if (!rrule) {
    m = take(/每(?:个)?月(\d{1,2}|[一二三四五六七八九十]{1,3})[号日]/)
    if (m) {
      repeatMonthDay = cnToNumber(m[1])
      rrule = `FREQ=MONTHLY;BYMONTHDAY=${repeatMonthDay}`
    }
  }

  // 每 N 天/周/月/年
  if (!rrule) {
    m = take(/每(\d{1,3}|[一二三四五六七八九十]{1,3})(天|日|周|星期|个月|月|年)/)
    if (m) {
      const n = Math.max(1, cnToNumber(m[1]))
      const unit = m[2]
      if (unit === '天' || unit === '日') rrule = `FREQ=DAILY;INTERVAL=${n}`
      else if (unit === '周' || unit === '星期') rrule = `FREQ=WEEKLY;INTERVAL=${n}`
      else if (unit === '年') rrule = `FREQ=YEARLY;INTERVAL=${n}`
      else rrule = `FREQ=MONTHLY;INTERVAL=${n}`
    }
  }

  if (!rrule) {
    m = take(/每(?:天|日)/)
    if (m) rrule = 'FREQ=DAILY'
  }
  if (!rrule) {
    m = take(/每(?:个)?(?:周|星期|礼拜)/)
    if (m) rrule = 'FREQ=WEEKLY'
  }
  if (!rrule) {
    m = take(/每(?:个)?月/)
    if (m) rrule = 'FREQ=MONTHLY'
  }
  if (!rrule) {
    m = take(/每(?:年)/)
    if (m) rrule = 'FREQ=YEARLY'
  }

  // ── date ──────────────────────────────────────────────
  const today = startOfDay(now)
  let dateOnly: Date | null = null
  let forcedHour: number | null = null

  if ((m = take(/(今晚|今夜)/))) {
    dateOnly = today
    forcedHour = 20
  } else if ((m = take(/(明晚|明天晚上)/))) {
    dateOnly = addDays(today, 1)
    forcedHour = 20
  } else if ((m = take(/(明早|明天早上)/))) {
    dateOnly = addDays(today, 1)
    forcedHour = 8
  } else if ((m = take(/(大后天)/))) {
    dateOnly = addDays(today, 3)
  } else if ((m = take(/(后天)/))) {
    dateOnly = addDays(today, 2)
  } else if ((m = take(/(明天|明日)/))) {
    dateOnly = addDays(today, 1)
  } else if ((m = take(/(今天|今日)/))) {
    dateOnly = today
  } else if ((m = take(/(下下)(?:周|星期|礼拜)([一二三四五六日天])/))) {
    const wd = WEEKDAY[m[2]]
    const dow = today.getDay()
    let delta = (wd - dow + 7) % 7
    dateOnly = addDays(today, delta + 14)
  } else if ((m = take(/(下)(?:周|星期|礼拜)([一二三四五六日天])/))) {
    const wd = WEEKDAY[m[2]]
    const dow = today.getDay()
    let delta = (wd - dow + 7) % 7
    if (delta === 0) delta = 7
    dateOnly = addDays(today, delta + 7)
  } else if ((m = take(/(?:本|这)?(?:周|星期|礼拜)([一二三四五六日天])/))) {
    const wd = WEEKDAY[m[1]]
    const dow = today.getDay()
    const delta = (wd - dow + 7) % 7
    dateOnly = addDays(today, delta)
  } else if ((m = take(/(周末)/))) {
    const dow = today.getDay()
    const delta = (6 - dow + 7) % 7
    dateOnly = addDays(today, delta === 0 ? 7 : delta)
  } else if ((m = take(/(下个月初|下月初)/))) {
    dateOnly = startOfMonth(addMonths(today, 1))
  } else if ((m = take(/(月底|月末)/))) {
    dateOnly = endOfMonth(today)
  } else if ((m = take(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})[日号]?/))) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    dateOnly = d
  } else if ((m = take(/(\d{1,2})月(\d{1,2})[日号]/))) {
    let d = new Date(today.getFullYear(), Number(m[1]) - 1, Number(m[2]))
    if (d.getTime() < today.getTime()) d = addYears(d, 1)
    dateOnly = d
  } else if ((m = take(/(\d{1,2})[/-](\d{1,2})/))) {
    let d = new Date(today.getFullYear(), Number(m[1]) - 1, Number(m[2]))
    if (d.getTime() < today.getTime()) d = addYears(d, 1)
    dateOnly = d
  }

  // ── time ──────────────────────────────────────────────
  let hour: number | null = null
  let minute = 0
  const tm = take(
    /(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里)?\s*(\d{1,2}|[一二三四五六七八九十]{1,3})\s*(?:点|时|:)\s*(\d{1,2}|半|[一二三四五六七八九十]{1,3})?\s*分?/
  )
  if (tm) {
    const period = tm[1]
    hour = cnToNumber(tm[2])
    const mm = tm[3]
    minute = mm ? (mm === '半' ? 30 : cnToNumber(mm)) : 0
    if (period === '下午' || period === '傍晚' || period === '晚上' || period === '夜里') {
      if (hour < 12) hour += 12
    } else if (period === '中午') {
      if (hour < 11) hour += 12
    } else if (period === '凌晨') {
      if (hour === 12) hour = 0
    }
    if (hour > 23) hour = hour % 24
    if (forcedHour !== null && forcedHour >= 12 && hour < 12) hour += 12
  } else {
    const tm2 = take(/(\d{1,2}):(\d{2})/)
    if (tm2) {
      hour = Number(tm2[1])
      minute = Number(tm2[2])
      if (forcedHour !== null && forcedHour >= 12 && hour < 12) hour += 12
    } else if (forcedHour !== null) {
      hour = forcedHour
    }
  }

  // ── resolve dates ─────────────────────────────────────
  if (!dateOnly && repeatWeekdays?.length) {
    const dow = today.getDay()
    const deltas = repeatWeekdays.map((wd) => (wd - dow + 7) % 7)
    const min = Math.min(...deltas)
    dateOnly = addDays(today, min)
  }
  if (!dateOnly && repeatMonthDay) {
    const d = setDate(today, repeatMonthDay)
    dateOnly = d.getTime() < today.getTime() ? addMonths(d, 1) : d
  }
  if (!dateOnly && repeatNthWeekday) {
    dateOnly = nextNthWeekday(today, repeatNthWeekday.nth, repeatNthWeekday.wd)
  }
  if (!dateOnly && rrule && !anchorDate) {
    if (!hour) dateOnly = today
  }

  let dueAt: string | null = null
  let scheduledDate: string | null = null
  let dueAllDay = 0

  if (hour !== null) {
    let target = dateOnly ? new Date(dateOnly) : new Date(today)
    target.setHours(hour, minute, 0, 0)
    if (!dateOnly && target.getTime() < now.getTime()) {
      target = addDays(target, 1)
    }
    dueAt = target.toISOString()
    scheduledDate = localDate(target)
  } else if (dateOnly) {
    scheduledDate = localDate(dateOnly)
    dueAllDay = 1
  }

  const title = rest
    .replace(/\s+/g, ' ')
    .replace(/^[\s,，、;；:：]+|[\s,，、;；:：]+$/g, '')
    .trim()

  return {
    title: title || input.trim(),
    scheduledDate,
    dueAt,
    dueAllDay,
    rrule,
    repeatFrom: rrule ? 'due' : null,
    priority,
    listName,
    tagNames
  }
}
