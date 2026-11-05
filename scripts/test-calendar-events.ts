import assert from 'node:assert/strict'
import { eventDayKeys, eventTimeLabel, type ExternalCalendarEvent } from '../src/renderer/src/lib/calendar-events.ts'

function make(partial: Partial<ExternalCalendarEvent> & { startAt: string }): ExternalCalendarEvent {
  return { id: 'e1', title: '日程', endAt: null, allDay: false, ...partial }
}

const timed = make({
  startAt: new Date(2026, 10, 6, 9, 0).toISOString(),
  endAt: new Date(2026, 10, 6, 10, 0).toISOString()
})
assert.deepEqual(eventDayKeys(timed), ['2026-11-06'])
assert.equal(eventTimeLabel(timed), '09:00')

const allDay = make({
  startAt: new Date(2026, 10, 7, 0, 0).toISOString(),
  endAt: new Date(2026, 10, 8, 0, 0).toISOString(),
  allDay: true
})
assert.deepEqual(eventDayKeys(allDay), ['2026-11-07'], '全天日程的结束时间是次日 0 点，不应多标一天')
assert.equal(eventTimeLabel(allDay), '全天')

const overnight = make({
  startAt: new Date(2026, 10, 30, 23, 0).toISOString(),
  endAt: new Date(2026, 11, 1, 1, 0).toISOString()
})
assert.deepEqual(eventDayKeys(overnight), ['2026-11-30', '2026-12-01'], '跨天/跨月日程在每一天可见')

const malformed = make({ startAt: 'not-a-date' })
assert.deepEqual(eventDayKeys(malformed), [])
assert.equal(eventTimeLabel(malformed), '')

console.log('PASS 订阅日程按本地日期映射（全天/跨天/跨月）')
