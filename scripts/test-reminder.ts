import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_SNOOZE_MINUTES,
  buildTaskToastXml,
  escapeXml,
  parseReminderProtocol
} from '../src/main/reminder.ts'
import {
  closeDb,
  createTask,
  getDueReminders,
  getTask,
  initDb,
  markReminderSent,
  setTaskStatus,
  snoozeReminder
} from '../src/main/db.ts'

// ---------- pure reminder helpers ----------

assert.equal(escapeXml(`& < > " '`), '&amp; &lt; &gt; &quot; &apos;')
assert.equal(escapeXml('普通文本'), '普通文本')

const trickyTitle = `买 <牛奶> & "面包" '今天'`
const trickyId = 'task/特殊 & id'
const encodedId = encodeURIComponent(trickyId)
const xml = buildTaskToastXml({ id: trickyId, title: trickyTitle })

assert.ok(xml.includes('<text>轻单 · 提醒</text>'), 'toast title')
assert.ok(xml.includes(`<text>${escapeXml(trickyTitle)}</text>`), 'escaped body title')
assert.ok(!xml.includes('<牛奶>'), 'raw title markup must not leak into XML')
assert.ok(
  xml.includes(`launch="lighttodo://open?id=${encodedId}"`),
  'toast body opens the task'
)
assert.ok(
  xml.includes(`arguments="lighttodo://complete?id=${encodedId}"`),
  'complete action URL'
)
assert.ok(
  xml.includes(`arguments="lighttodo://snooze?id=${encodedId}&amp;minutes=10"`),
  'snooze action URL keeps a single XML-escaped ampersand'
)
assert.ok(!xml.includes('&amp;amp;'), 'ampersand must not be double escaped')
assert.ok(xml.includes('content="完成"'), 'complete button label')
assert.ok(xml.includes('content="稍后 10 分钟"'), 'snooze button label')
console.log('OK toast XML + escaping')

assert.deepEqual(parseReminderProtocol('lighttodo://complete?id=abc'), {
  action: 'complete',
  id: 'abc'
})
assert.deepEqual(parseReminderProtocol('lighttodo://snooze?id=abc&minutes=10'), {
  action: 'snooze',
  id: 'abc',
  minutes: 10
})
assert.deepEqual(parseReminderProtocol('lighttodo://snooze?id=abc'), {
  action: 'snooze',
  id: 'abc',
  minutes: DEFAULT_SNOOZE_MINUTES
})
assert.deepEqual(parseReminderProtocol('lighttodo://open?id=abc'), { action: 'open', id: 'abc' })
assert.deepEqual(parseReminderProtocol('lighttodo://open?id=a%26b'), {
  action: 'open',
  id: 'a&b'
})

// minutes boundaries: absent/invalid -> 10, out of range is clamped to 1..1440.
assert.equal(parseReminderProtocol('lighttodo://snooze?id=x&minutes=1')?.minutes, 1)
assert.equal(parseReminderProtocol('lighttodo://snooze?id=x&minutes=1440')?.minutes, 1440)
assert.equal(parseReminderProtocol('lighttodo://snooze?id=x&minutes=0')?.minutes, 1)
assert.equal(parseReminderProtocol('lighttodo://snooze?id=x&minutes=-5')?.minutes, 1)
assert.equal(parseReminderProtocol('lighttodo://snooze?id=x&minutes=1441')?.minutes, 1440)
assert.equal(parseReminderProtocol('lighttodo://snooze?id=x&minutes=abc')?.minutes, 10)
assert.equal(parseReminderProtocol('lighttodo://snooze?id=x&minutes=10.6')?.minutes, 11)

// invalid URL / wrong scheme / unknown action / missing id all return null.
for (const invalid of [
  'not a url',
  '',
  'https://lighttodo/complete?id=abc',
  'lighttodo:complete?id=abc',
  'lighttodo://unknown?id=abc',
  'lighttodo://complete',
  'lighttodo://complete?id=',
  'lighttodo://complete?id=%20'
]) {
  assert.equal(parseReminderProtocol(invalid), null, `expected null for ${invalid}`)
}
console.log('OK protocol parsing + minutes boundaries')

// ---------- DB snooze ----------

const dir = join(process.cwd(), '.tmp', 'qa', 'reminder')
rmSync(dir, { recursive: true, force: true })
initDb(dir)

const task = createTask({
  title: '提醒闭环测试',
  reminderAt: new Date(Date.now() - 60_000).toISOString()
})
assert.ok(
  getDueReminders(new Date().toISOString()).some((t) => t.id === task.id),
  'past reminder is due'
)

// Simulate the loop having already fired it, then snooze: the reminder must be
// re-armed for the future and notified_at cleared.
markReminderSent(task.id)
assert.ok(
  !getDueReminders(new Date().toISOString()).some((t) => t.id === task.id),
  'sent reminder is no longer due'
)

const beforeSnooze = Date.now()
snoozeReminder(task.id, 10)
const afterSnooze = Date.now()
assert.ok(
  !getDueReminders(new Date(afterSnooze).toISOString()).some((t) => t.id === task.id),
  'snoozed reminder is not due until later'
)
const snoozed = getTask(task.id)!
assert.equal(snoozed.notifiedAt, null, 'snooze clears notified_at')
assert.ok(snoozed.reminderAt, 'snooze keeps reminder_at set')
const deltaMs = new Date(snoozed.reminderAt!).getTime() - beforeSnooze
assert.ok(
  deltaMs >= 9.5 * 60_000 && deltaMs <= 10.5 * 60_000,
  `reminder_at should be ~10 minutes ahead, got ${deltaMs}ms`
)

// Completed tasks must not be snoozed back into the reminder queue.
setTaskStatus(task.id, true)
const completedReminderAt = getTask(task.id)!.reminderAt
assert.equal(completedReminderAt, null, 'completion clears reminder_at')
snoozeReminder(task.id, 10)
assert.equal(getTask(task.id)!.reminderAt, null, 'completed task ignores snooze')
assert.equal(getTask(task.id)!.notifiedAt, null, 'completed task keeps notified_at untouched')

closeDb()
console.log('OK DB snooze semantics')
console.log('PASS test-reminder')
