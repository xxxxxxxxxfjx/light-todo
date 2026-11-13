import assert from 'node:assert/strict'
import { sortReportTitles } from '../src/renderer/src/lib/report-sort.ts'
import { buildDayReport } from '../src/renderer/src/lib/day-report.ts'
import { buildWeekReport } from '../src/renderer/src/lib/week-report.ts'

const sorted = sortReportTitles([
  { title: '整理明天的待办' },
  { title: '写完周报' },
  { title: '跑步' },
  { title: '写周报' }
])
assert.deepEqual(
  sorted.map((task) => task.title),
  ['跑步', '写周报', '写完周报', '整理明天的待办'],
  '日报排序：短的在前，相似的写周报/写完周报挨在一起'
)

assert.equal(
  buildDayReport('2026-11-06', [
    { title: '整理明天的待办' },
    { title: '跑步' },
    { title: '写完周报' },
    { title: '写周报' }
  ]),
  ['2026/11/06：', '1. 跑步', '2. 写周报', '3. 写完周报', '4. 整理明天的待办'].join('\n')
)

assert.equal(
  buildWeekReport('2026-11-09', '2026-11-15', [{ title: '写完周报' }, { title: '跑步' }]),
  ['2026/11/09 - 2026/11/15：', '1. 跑步', '2. 写完周报'].join('\n')
)

console.log('PASS 日报/周报：长度优先 + 相似度聚类')
