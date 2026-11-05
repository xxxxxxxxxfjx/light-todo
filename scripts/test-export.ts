import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { buildIcs, buildTaskCsv } from '../src/main/export.ts'
import { initDb, getLists, getTask, searchTasks } from '../src/main/db.ts'
import { importFromText } from '../src/main/import.ts'
import type { List, Tag, Task } from '../src/shared/types.ts'

let failed = 0
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) console.log('PASS', name)
  else {
    failed++
    console.error('FAIL', name, detail ?? '')
  }
}

function makeTask(overrides: Partial<Task> & { title: string }): Task {
  return {
    id: 'task',
    listId: null,
    parentId: null,
    title: overrides.title,
    notes: '',
    priority: 0,
    status: 0,
    someday: false,
    scheduledDate: null,
    dueAt: null,
    dueAllDay: 0,
    rrule: null,
    repeatFrom: null,
    reminderAt: null,
    reminderOffset: null,
    notifiedAt: null,
    completedAt: null,
    deletedAt: null,
    sortOrder: 0,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    tags: [],
    subtaskCount: 0,
    subtaskDone: 0,
    ...overrides
  }
}

const workList: List = {
  id: 'list-work',
  folderId: null,
  name: '工作',
  color: null,
  icon: null,
  sortOrder: 0,
  isPinned: 0,
  archivedAt: null,
  createdAt: '2026-11-01T00:00:00.000Z'
}
const tagReport: Tag = { id: 'tag-report', name: '汇报', color: null }
const tagWeek: Tag = { id: 'tag-week', name: '周', color: null }

const timed = new Date(2026, 10, 5, 14, 30, 0, 0)
const weekly = new Date(2026, 10, 7, 9, 15, 0, 0)
const tasks: Task[] = [
  makeTask({
    id: 't1',
    title: '写"周报", 并发送',
    notes: '第一行\n含 "引号" 与,逗号',
    listId: workList.id,
    priority: 3,
    status: 1,
    scheduledDate: '2026-11-05',
    dueAt: timed.toISOString(),
    tags: [tagReport, tagWeek]
  }),
  makeTask({
    id: 't2',
    title: '全天任务',
    scheduledDate: '2026-11-06',
    priority: 2
  }),
  makeTask({
    id: 't3',
    title: '定时任务',
    dueAt: weekly.toISOString(),
    priority: 1,
    rrule: 'FREQ=WEEKLY'
  })
]

const csv = buildTaskCsv(tasks, [workList])
check('EXP-01 CSV 带 UTF-8 BOM', csv.charCodeAt(0) === 0xfeff)
check(
  'EXP-02 CSV 表头',
  csv.split('\r\n')[0] === '\uFEFF标题,清单,标签,优先级,计划日,截止时间,完成状态,备注',
  csv.split('\r\n')[0]
)
check(
  'EXP-03 CSV 标题按 RFC4180 转义',
  csv.includes('"写""周报"", 并发送"'),
  csv.split('\r\n')[1]
)
check(
  'EXP-04 CSV 备注逗号/引号/换行转义',
  csv.includes('"第一行\n含 ""引号"" 与,逗号"'),
  csv.split('\r\n')[1]
)
check('EXP-05 CSV 标签用顿号连接', csv.includes('汇报、周'), csv.split('\r\n')[1])
check('EXP-06 CSV 清单名', csv.split('\r\n')[1].includes('工作'))
check('EXP-07 CSV 优先级高/中/低', csv.includes(',高,') && csv.includes(',中,') && csv.includes(',低,'))
check('EXP-08 CSV 完成状态', csv.includes(',已完成,') && csv.includes(',未完成,'))
check('EXP-09 CSV 计划日', csv.includes(',2026-11-06,'))
check('EXP-10 CSV 截止时间本地格式', csv.includes(',2026-11-05 14:30,'), csv.split('\r\n')[1])

const now = new Date(Date.UTC(2026, 10, 5, 6, 0, 0))
const ics = buildIcs(tasks, now)
check('EXP-11 ICS VCALENDAR', ics.includes('BEGIN:VCALENDAR') && ics.includes('END:VCALENDAR'))
check('EXP-12 ICS VERSION/PRODID', ics.includes('VERSION:2.0') && ics.includes('PRODID:-//LightTodo//CN'))
check('EXP-13 ICS 每个有日期任务一个 VEVENT', (ics.match(/BEGIN:VEVENT/g) ?? []).length === 3)
check('EXP-14 ICS 全天 VALUE=DATE', ics.includes('DTSTART;VALUE=DATE:20261106'))
check('EXP-15 ICS 定时本地时间无 Z', ics.includes('DTSTART:20261107T091500'))
check('EXP-16 ICS RRULE 原样输出', ics.includes('RRULE:FREQ=WEEKLY'))
check('EXP-17 ICS UID', ics.includes('UID:t1@lighttodo'))
check('EXP-18 ICS DTSTAMP UTC', ics.includes('DTSTAMP:20261105T060000Z'))
check('EXP-19 ICS SUMMARY 逗号转义', ics.includes('SUMMARY:写"周报"\\, 并发送'), ics)
check(
  'EXP-20 ICS DESCRIPTION 换行/逗号转义',
  ics.includes('DESCRIPTION:第一行\\n含 "引号" 与\\,逗号'),
  ics
)

const dir = join(process.cwd(), '.tmp', 'qa', 'export')
rmSync(dir, { recursive: true, force: true })
initDb(dir)

const msTodoCsv = `\uFEFFSUBJECT,status,Completed,Importance,Due  Date,Start Date,Notes,List  Name
寄送合同,Not Started,false,High,2026-11-08,,"第一行
第二行",工作
打电话,Completed,true,Normal,2026-11-06 15:30,,,生活
无清单任务,Not Started,false,Low,,2026-11-07,用开始日期,
`
const r1 = importFromText(msTodoCsv, 'microsoft-todo.csv')
check('EXP-21 MS To Do 导入成功', r1.ok && r1.tasks === 3, r1)

const contract = searchTasks('寄送合同')[0]
check('EXP-22 MS 标题', !!contract && contract.title === '寄送合同', contract?.title)
check('EXP-23 MS 备注换行', getTask(contract.id)?.notes === '第一行\n第二行', getTask(contract.id)?.notes)
check('EXP-24 MS Importance High→3', contract.priority === 3, contract.priority)
check('EXP-25 MS 全天日期进 scheduledDate', contract.scheduledDate === '2026-11-08', contract.scheduledDate)
check('EXP-26 MS 全天无 dueAt', contract.dueAt === null, contract.dueAt)
check(
  'EXP-27 MS List Name 映射清单',
  getLists().find((l) => l.id === contract.listId)?.name === '工作',
  contract.listId
)

const call = searchTasks('打电话')[0]
check('EXP-28 MS Status=Completed 标记完成', call.status === 1, call.status)
check('EXP-29 MS Completed=true 标记完成', getTask(call.id)?.completedAt !== null, getTask(call.id)?.completedAt)
check('EXP-30 MS 日期+时间进 dueAt', new Date(call.dueAt!).getHours() === 15 && new Date(call.dueAt!).getMinutes() === 30, call.dueAt)
check('EXP-31 MS 定时任务无 scheduledDate', call.scheduledDate === null, call.scheduledDate)
check('EXP-32 MS Importance Normal→0', call.priority === 0, call.priority)

const noList = searchTasks('无清单任务')[0]
check('EXP-33 MS Start Date 兜底', noList.scheduledDate === '2026-11-07', noList.scheduledDate)
check('EXP-34 MS 无清单保持 null', noList.listId === null, noList.listId)
check('EXP-35 MS Importance Low→1', noList.priority === 1, noList.priority)

// Completed-only header (no Status) with the List alias must still be detected.
const miniCsv = `Subject,Completed,Start Date,Importance,List
仅完成列,true,,Low,杂项
`
const r2 = importFromText(miniCsv, 'ms-todo-mini.csv')
const mini = searchTasks('仅完成列')[0]
check('EXP-36 MS Completed-only 表头识别', r2.ok && r2.tasks === 1, r2)
check('EXP-37 MS Completed-only 完成', mini?.status === 1, mini?.status)
check('EXP-38 MS List 别名', mini?.listId === getLists().find((l) => l.name === '杂项')?.id, mini?.listId)

if (failed) {
  console.error(`\n${failed} 个导出/导入用例失败`)
  process.exit(1)
}
console.log('\n导出/导入全部通过')
