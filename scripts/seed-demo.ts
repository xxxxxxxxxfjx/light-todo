import { join } from 'node:path'
import { initDb, createTask, setTaskStatus, getLists } from '../src/main/db.ts'
import { format, addDays } from 'date-fns'

const dir = join(process.cwd(), '.tmp', 'qa', 'data')
initDb(dir)
const lists = getLists()
const work = lists.find((l) => l.name === '工作')
const life = lists.find((l) => l.name === '生活')
const today = new Date()
const y = format(addDays(today, -1), 'yyyy-MM-dd')
const t = format(today, 'yyyy-MM-dd')
const tm = format(addDays(today, 1), 'yyyy-MM-dd')

const a = createTask({
  title: '写 Q4 汇报大纲',
  notes: '先拉数据，再补三页结论。',
  listId: work?.id,
  scheduledDate: t,
  dueAt: new Date(new Date().setHours(15, 0, 0, 0)).toISOString(),
  priority: 3,
  tagNames: ['汇报']
})
const b = createTask({
  title: '和设计确认新版首页',
  listId: work?.id,
  scheduledDate: t,
  priority: 2
})
const c = createTask({
  title: '回复客户邮件',
  listId: work?.id,
  scheduledDate: y,
  priority: 2
})
createTask({
  title: '周会材料',
  listId: work?.id,
  scheduledDate: tm,
  priority: 1
})
createTask({ title: '读《深度工作》第三章', listId: life?.id, priority: 0 })
const done = createTask({ title: '晨会纪要', listId: work?.id, scheduledDate: t })
setTaskStatus(done.id, true)

console.log('seeded', a.title, b.title, c.title)
