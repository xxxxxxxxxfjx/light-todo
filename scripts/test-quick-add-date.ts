import assert from 'node:assert/strict'
import { resolveQuickAddDate } from '../src/renderer/src/lib/quick-add-date.ts'

const day = '2026-11-10'
assert.equal(resolveQuickAddDate(undefined, 'calendar', day, false), day, '日历视图默认落到选中日')
assert.equal(resolveQuickAddDate('', 'calendar', day, false), day, '空显式值不应覆盖选中日')
assert.equal(resolveQuickAddDate('2026-11-20', 'calendar', day, false), '2026-11-20', '显式日期优先')
assert.equal(resolveQuickAddDate(undefined, 'calendar', day, true), null, '全局捕获仍进收件箱')
assert.equal(resolveQuickAddDate(undefined, 'today', day, false), null, '非日历视图不继承日历日期')
assert.equal(resolveQuickAddDate(undefined, 'calendar', null, false), null, '没有选中日时不补日期')

console.log('PASS 日历选中日 -> 快速添加默认日期')
