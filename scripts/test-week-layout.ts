import assert from 'node:assert/strict'
import type { Task } from '../src/shared/types.ts'
import { layoutWeekSchedule } from '../src/renderer/src/lib/week-layout.ts'

const task = (id: string, hour: number, minute: number): Task => ({ id, dueAt: new Date(2026, 10, 4, hour, minute).toISOString() } as Task)
const dense = [task('a', 15, 0), task('b', 15, 0), task('c', 15, 20), task('d', 15, 30), task('e', 15, 30), task('f', 16, 0)]
const source = [...dense]
const layout = layoutWeekSchedule([dense, [task('other-day', 16, 0)], [], [], [], [], [task('late', 23, 59)]])
assert.deepEqual(layout.days[0].map(g => g.tasks.map(t => t.id)), [['a', 'b'], ['c'], ['d', 'e'], ['f']])
assert.deepEqual(dense, source, '布局不得改动来源数组')
const flattened = layout.days[0].flatMap(g => g.tasks.map(t => t.id))
assert.equal(new Set(flattened).size, dense.length, '所有同一时间任务必须保留且只展示一次')
for (const day of layout.days) {
  for (let i = 0; i < day.length; i++) {
    const group = day[i]
    const hour = Math.floor(group.start / 60)
    assert.ok(group.top >= layout.hours[hour].top)
    assert.ok(group.top + group.height <= layout.hours[hour].top + layout.hours[hour].height, '任务不得溢出到下一小时')
    if (i > 0) assert.ok(day[i - 1].top + day[i - 1].height <= group.top, '相邻时刻卡片不得重叠')
  }
}
assert.equal(layout.days[0][3].top, layout.days[1][0].top, '各天的同一小时必须对齐')
assert.ok(layout.height >= layout.days[6][0].top + layout.days[6][0].height, '23:59 的任务不能被截断')
assert.equal(layoutWeekSchedule([[]]).height, 24 * 44)
assert.equal(layoutWeekSchedule([[{ id: 'bad', dueAt: 'invalid' } as Task]]).days[0].length, 0)
console.log('PASS 周历：同刻分组、相邻时刻无重叠、跨天时间对齐、午夜边界和无效时间')
