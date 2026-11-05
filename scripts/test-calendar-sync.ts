import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  closeDb,
  commitCalendarSubscriptionSync,
  getCalendarEvents,
  getCalendarSubscription,
  initDb
} from '../src/main/db.ts'
import { syncIcsSubscription } from '../src/main/calendar-sync.ts'

const dir = join(process.cwd(), '.tmp', 'qa', 'calendar-sync')
rmSync(dir, { recursive: true, force: true })
initDb(dir)

const OLD_URL = 'https://old.example/calendar.ics'
const NEW_URL = 'https://new.example/calendar.ics'
commitCalendarSubscriptionSync('1', OLD_URL, '旧日历', [
  { uid: 'old-1', title: '旧日程', startAt: '2026-11-05T10:00:00.000Z', endAt: null, allDay: false, rrule: null }
])

const failFetch = async (): Promise<Response> => new Response('nope', { status: 500, statusText: 'Server Error' })

// 1. 新地址同步失败：地址、名称、事件快照都必须保持旧值。
await assert.rejects(syncIcsSubscription(NEW_URL, failFetch), /HTTP 500/)
let sub = getCalendarSubscription()
assert.equal(sub?.url, OLD_URL)
assert.equal(sub?.name, '旧日历')
assert.deepEqual(getCalendarEvents('2026-11-01T00:00:00.000Z', '2026-11-30T23:59:59.999Z').map((event) => event.title), ['旧日程'])

// 2. 同一地址同步失败：保留地址与旧事件，只记录错误。
await assert.rejects(syncIcsSubscription(OLD_URL, failFetch), /HTTP 500/)
sub = getCalendarSubscription()
assert.equal(sub?.url, OLD_URL)
assert.equal(sub?.lastError?.includes('HTTP 500'), true)
assert.deepEqual(getCalendarEvents('2026-11-01T00:00:00.000Z', '2026-11-30T23:59:59.999Z').map((event) => event.title), ['旧日程'])

// 3. 新地址同步成功：地址、名称、事件和同步时间一次性切换。
const ics = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'X-WR-CALNAME:新日历',
  'BEGIN:VEVENT',
  'UID:new-1',
  'SUMMARY:新日程',
  'DTSTART:20261106T090000Z',
  'DTEND:20261106T100000Z',
  'END:VEVENT',
  'END:VCALENDAR',
  ''
].join('\r\n')
const okFetch = async (): Promise<Response> => new Response(ics, { status: 200 })
const result = await syncIcsSubscription(NEW_URL, okFetch)
assert.equal(result.count, 1)
assert.equal(result.name, '新日历')
sub = getCalendarSubscription()
assert.equal(sub?.url, NEW_URL)
assert.equal(sub?.name, '新日历')
assert.equal(sub?.lastError, null)
assert.ok(sub?.lastSyncedAt)
const events = getCalendarEvents('2026-11-01T00:00:00.000Z', '2026-11-30T23:59:59.999Z')
assert.deepEqual(events.map((event) => event.title), ['新日程'])
assert.equal(events[0].uid, 'new-1')

// 4. 切换到没有名称的日历时，旧名称不能被沿用。
const icsNoName = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:no-name-1',
  'SUMMARY:无名称日历日程',
  'DTSTART:20261107T090000Z',
  'END:VEVENT',
  'END:VCALENDAR',
  ''
].join('\r\n')
await syncIcsSubscription('https://noname.example/cal.ics', async () => new Response(icsNoName, { status: 200 }))
sub = getCalendarSubscription()
assert.equal(sub?.url, 'https://noname.example/cal.ics')
assert.equal(sub?.name, null, '切换日历后旧名称不应残留')

// 5. 首次订阅就失败：保留用户输入的地址并记录错误，便于直接重试。
closeDb()
const firstDir = join(process.cwd(), '.tmp', 'qa', 'calendar-sync-first')
rmSync(firstDir, { recursive: true, force: true })
initDb(firstDir)
await assert.rejects(syncIcsSubscription('https://first.example/a.ics', failFetch), /HTTP 500/)
const first = getCalendarSubscription()
assert.equal(first?.url, 'https://first.example/a.ics')
assert.equal(first?.lastError?.includes('HTTP 500'), true)
closeDb()

console.log('PASS 日历新地址失败不覆盖旧订阅与旧事件')
console.log('PASS 日历同步成功在事务内切换地址/名称/事件/状态')
