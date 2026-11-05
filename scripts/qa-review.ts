import * as db from '../src/main/db.ts'
import { importFromText } from '../src/main/import.ts'
import { join } from 'node:path'

const dir = join(process.cwd(), '.tmp', 'qa', 'review', String(Date.now()))
db.initDb(dir)
const result: Record<string, unknown> = { dataDir: dir }
const list = db.createList({ name: 'QA列表' })
const parent = db.createTask({ title: 'QA导出父任务', listId: list.id, rrule: 'FREQ=DAILY', scheduledDate: '2026-11-03', reminderOffset: 5 })
db.createTask({ title: 'QA导出子任务', parentId: parent.id, notes: '子备注' })
db.setTaskStatus(parent.id, true)
const exported = db.getAllData()
const r = importFromText(JSON.stringify(exported), 'export.json')
result.jsonRoundTrip = { import: r, copies: db.searchTasks('QA导出父任务').map(t => ({ listId: t.listId, status: t.status, rrule: t.rrule, reminderOffset: t.reminderOffset })), children: db.searchTasks('QA导出子任务').map(t => ({parentId: t.parentId})) }
const repeat = db.createTask({ title: 'QA反复完成', scheduledDate: '2026-11-03', rrule: 'FREQ=DAILY' })
db.setTaskStatus(repeat.id, true)
db.setTaskStatus(repeat.id, false)
db.setTaskStatus(repeat.id, true)
result.repeatUndo = db.searchTasks('QA反复完成').map(t => ({status:t.status, date:t.scheduledDate}))
const reminder = db.createTask({ title: 'QA恢复提醒', dueAt: '2026-11-04T01:00:00.000Z', reminderOffset: 5 })
const before = db.getTask(reminder.id)?.reminderAt
db.setTaskStatus(reminder.id, true)
db.setTaskStatus(reminder.id, false)
result.reminderUndo = { before, after: db.getTask(reminder.id)?.reminderAt, offset: db.getTask(reminder.id)?.reminderOffset }
const moving = db.createTask({ title: 'QA移动父任务', listId:list.id })
const sub = db.createTask({ title: 'QA移动子任务', parentId:moving.id })
db.updateTask(moving.id, { listId:null })
result.moveParent = {parentList:db.getTask(moving.id)?.listId, childList:db.getTask(sub.id)?.listId}
const bad = importFromText(JSON.stringify({tasks:[{title:'QA部分写入'}, {title:null}]}), 'bad.json')
result.partialImport = {result:bad, saved:db.searchTasks('QA部分写入').length}
const csv=importFromText('标题,完成状态\nQA未完成状态,未完成\n','ticktick.csv')
result.csvStatus = {import:csv, status:db.searchTasks('QA未完成状态')[0]?.status}
const todoist=importFromText('TYPE,CONTENT,PRIORITY,INDENT\nsection,QA章节,4,1\nnote,QA说明,4,1\ntask,QA任务,4,1\n','todoist.csv')
result.todoistTypes = {import:todoist, titles:db.searchTasks('QA章节').map(t=>t.title)}
console.log(JSON.stringify(result,null,2))
db.closeDb()
