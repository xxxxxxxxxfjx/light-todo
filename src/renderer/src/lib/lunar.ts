/**
 * Chinese lunar calendar labels using the ICU Chinese calendar built into
 * Chromium/Node. No lookup table or network request is needed, and leap months
 * are reported by Intl as "闰四月".
 */
const LUNAR_MONTHS = [
  '正月',
  '二月',
  '三月',
  '四月',
  '五月',
  '六月',
  '七月',
  '八月',
  '九月',
  '十月',
  '冬月',
  '腊月'
]

const LUNAR_DAYS = [
  '初一',
  '初二',
  '初三',
  '初四',
  '初五',
  '初六',
  '初七',
  '初八',
  '初九',
  '初十',
  '十一',
  '十二',
  '十三',
  '十四',
  '十五',
  '十六',
  '十七',
  '十八',
  '十九',
  '二十',
  '廿一',
  '廿二',
  '廿三',
  '廿四',
  '廿五',
  '廿六',
  '廿七',
  '廿八',
  '廿九',
  '三十'
]

const LUNAR_FESTIVALS: Record<string, string> = {
  '1-1': '春节',
  '1-15': '元宵',
  '2-2': '龙抬头',
  '5-5': '端午',
  '7-7': '七夕',
  '7-15': '中元',
  '8-15': '中秋',
  '9-9': '重阳',
  '12-8': '腊八',
  '12-23': '小年'
}

// Qingming is a solar term, not a fixed Gregorian date; keep the near-term
// dates explicit rather than pretending it is always April 4.
const QINGMING: Record<number, string> = {
  2024: '04-04',
  2025: '04-04',
  2026: '04-05',
  2027: '04-05',
  2028: '04-04',
  2029: '04-04',
  2030: '04-05'
}

const SOLAR_FESTIVALS: Record<string, string> = {
  '01-01': '元旦',
  '05-01': '劳动节',
  '10-01': '国庆节'
}

/**
 * Official mainland China holiday/make-up-workday ranges. 2027 is intentionally
 * absent until the State Council publishes it; weekends fall back to rest.
 * Source: public holiday schedule (2024–2026), encoded locally so the calendar
 * never needs a network request.
 */
const HOLIDAY_RANGES: Record<number, [string, string][]> = {
  2024: [
    ['01-01', '01-01'],
    ['02-10', '02-17'],
    ['04-04', '04-06'],
    ['05-01', '05-05'],
    ['06-08', '06-10'],
    ['09-15', '09-17'],
    ['10-01', '10-07']
  ],
  2025: [
    ['01-01', '01-01'],
    ['01-28', '02-04'],
    ['04-04', '04-06'],
    ['05-01', '05-05'],
    ['05-31', '06-02'],
    ['10-01', '10-08']
  ],
  2026: [
    ['01-01', '01-03'],
    ['02-15', '02-23'],
    ['04-04', '04-06'],
    ['05-01', '05-05'],
    ['06-19', '06-21'],
    ['09-25', '09-27'],
    ['10-01', '10-07']
  ]
}

const MAKEUP_WORKDAYS: Record<number, string[]> = {
  2024: ['02-04', '02-18', '04-07', '04-28', '05-11', '09-14', '09-29', '10-12'],
  2025: ['01-26', '02-08', '04-27', '09-28', '10-11'],
  2026: ['01-04', '02-14', '02-28', '05-09', '09-20', '10-10']
}

function monthDay(date: Date): string {
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function inRange(date: Date, range: [string, string]): boolean {
  const key = monthDay(date)
  return key >= range[0] && key <= range[1]
}

export type HolidayStatus = 'holiday' | 'workday' | null

export function getHolidayStatus(date: Date): HolidayStatus {
  const year = date.getFullYear()
  const key = monthDay(date)
  if (MAKEUP_WORKDAYS[year]?.includes(key)) return 'workday'
  if (HOLIDAY_RANGES[year]?.some((range) => inRange(date, range))) return 'holiday'
  return isWeekend(date) ? 'holiday' : null
}

export interface LunarInfo {
  month: number
  day: number
  monthName: string
  dayName: string
  /** Short label suitable for a calendar cell: festival > month name > day name. */
  text: string
  festival: string | null
  isLeap: boolean
}

const formatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
  month: 'long',
  day: 'numeric'
})

export function getLunarInfo(date: Date): LunarInfo {
  const parts = formatter.formatToParts(date)
  const rawMonth = parts.find((part) => part.type === 'month')?.value ?? '正月'
  const rawDay = Number(parts.find((part) => part.type === 'day')?.value ?? '1')
  const isLeap = rawMonth.startsWith('闰')
  const monthName = rawMonth.replace(/^闰/, '')
  const month = Math.max(1, LUNAR_MONTHS.indexOf(monthName) + 1)
  const day = Math.min(30, Math.max(1, Number.isFinite(rawDay) ? rawDay : 1))
  const dayName = LUNAR_DAYS[day - 1] ?? `第${day}天`
  // 闰月里的同月同日不是固定农历节日（如闰二月初二不是龙抬头）。
  const festival = isLeap ? null : LUNAR_FESTIVALS[`${month}-${day}`] ?? null

  return {
    month,
    day,
    monthName,
    dayName,
    text: festival ?? (day === 1 ? (isLeap ? `闰${monthName}` : monthName) : dayName),
    festival,
    isLeap
  }
}

/** Calendar-cell annotation: festival, make-up workday, rest day or lunar date. */
export function calendarAnnotation(date: Date): string {
  const info = getLunarInfo(date)
  const status = getHolidayStatus(date)
  if (status === 'workday') return '班'
  if (info.festival) return info.festival
  const solarKey = monthDay(date)
  const qingming = QINGMING[date.getFullYear()]
  if (qingming === solarKey) return '清明'
  const solarFestival = SOLAR_FESTIVALS[solarKey]
  if (solarFestival) return solarFestival
  if (status === 'holiday') return '休'
  return info.text
}

/** True for Saturday/Sunday; statutory-holiday awareness is layered separately. */
export function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6
}
