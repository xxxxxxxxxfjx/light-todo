import { rmSync } from 'node:fs'
import { initDb, createTask } from '../src/main/db.ts'
import { format, addDays } from 'date-fns'

const dir = 'E:\\code\\todo\\.qa-perf'
rmSync(dir, { recursive: true, force: true })
initDb(dir)

const lists = ['工作', '生活', '学习', '项目A', '项目B']
const tagsPool = ['紧急', '汇报', '阅读', '会议', '等待']
const N = 2000
const t0 = Date.now()
for (let i = 0; i < N; i++) {
  const d = addDays(new Date(), (i % 14) - 2)
  createTask({
    title: `任务 ${i + 1}：${lists[i % lists.length]} 的事项`,
    notes: i % 5 === 0 ? '这是一条备注，包含一些正文内容用于全文检索。' : '',
    scheduledDate: i % 3 === 0 ? format(d, 'yyyy-MM-dd') : null,
    priority: i % 10 === 0 ? 3 : i % 4 === 0 ? 2 : i % 3 === 0 ? 1 : 0,
    tagNames: i % 2 === 0 ? [tagsPool[i % tagsPool.length]] : []
  })
  if (i % 500 === 499) console.log('seeded', i + 1, `${Date.now() - t0}ms`)
}
console.log('DONE', N, `${Date.now() - t0}ms`)
