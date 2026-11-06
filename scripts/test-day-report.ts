import assert from 'node:assert/strict'
import { buildDayReport } from '../src/renderer/src/lib/day-report.ts'

assert.equal(
  buildDayReport('2026-11-06', [
    { title: '写完周报' },
    { title: '跑步 5 公里' },
    { title: '整理明天的待办' }
  ]),
  ['2026/11/06：', '1. 写完周报', '2. 跑步 5 公里', '3. 整理明天的待办'].join('\n'),
  '日报格式：日期标题 + 编号任务'
)

assert.equal(
  buildDayReport('2026-11-06', [{ title: '第一行\n第二行' }]),
  ['2026/11/06：', '1. 第一行 第二行'].join('\n'),
  '标题里的换行压成一行，避免破坏编号列表'
)

assert.equal(buildDayReport('2026-11-06', []), '2026/11/06：', '没有完成项时只保留日期')

console.log('PASS 已完成日报格式')
