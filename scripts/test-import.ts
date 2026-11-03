import { rmSync } from 'node:fs'
import { initDb, getLists, searchTasks } from '../src/main/db.ts'
import { importFromText } from '../src/main/import.ts'

const dir = 'E:\\code\\todo\\.qa-import'
rmSync(dir, { recursive: true, force: true })
initDb(dir)

const ticktick = `标题,清单,标签,优先级,截止日期,子任务,备注,完成状态
交周报,工作,汇报,高,2026-11-05 15:00,,写 Q4 汇报,0
买菜,生活,,低,2026-11-03,,,
晨会纪要,工作,,中,2026-11-01,,已完成,1
读《深度工作》,生活,阅读,无,,,,0
`

const todoist = `TYPE,CONTENT,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE
task,写方案,1,1,,,2026-11-04,en,
task,拉数据,2,2,,,,,
task,画原型,4,1,,,,,
`

const r1 = importFromText(ticktick, 'ticktick.csv')
console.log('ticktick', JSON.stringify(r1))
const r2 = importFromText(todoist, 'todoist.csv')
console.log('todoist', JSON.stringify(r2))
const json = importFromText(
  JSON.stringify({
    lists: [{ name: '学习', color: '#123456' }],
    tasks: [
      { title: '看文档', priority: 1, tags: [{ name: '阅读' }] },
      { title: '做笔记', scheduledDate: '2026-11-03' }
    ]
  }),
  'backup.json'
)
console.log('json', JSON.stringify(json))

console.log('lists', getLists().map((l) => [l.name, l.count]))
console.log('search 周报', searchTasks('周报').map((t) => [t.title, t.priority, t.dueAt]))
console.log('search 子', searchTasks('拉数据').map((t) => [t.title, t.parentId !== null]))
