import { rmSync } from 'node:fs'
import { initDb, getLists, searchTasks, getTask } from '../src/main/db.ts'
import { importFromText } from '../src/main/import.ts'

let failed = 0
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) console.log('PASS', name)
  else {
    failed++
    console.error('FAIL', name, detail ?? '')
  }
}

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
const json = JSON.stringify({
  lists: [{ name: '学习', color: '#123456' }],
  tasks: [
    { title: '看文档', priority: 1, tags: [{ name: '阅读' }] },
    { title: '做笔记', scheduledDate: '2026-11-03' }
  ]
})

const r1 = importFromText(ticktick, 'ticktick.csv')
check('IMP-01 TickTick 条数', r1.ok && r1.tasks === 4, r1)
const report = getTask(searchTasks('交周报')[0].id)!
check('IMP-02 优先级', report.priority === 3, report.priority)
check('IMP-03 截止时间', new Date(report.dueAt!).getHours() === 15, report.dueAt)
check('IMP-04 标签', report.tags.some((t) => t.name === '汇报'), report.tags)

const r2 = importFromText(todoist, 'todoist.csv')
check('IMP-06 Todoist 条数', r2.ok && r2.tasks === 3, r2)
const child = searchTasks('拉数据')[0]
check('IMP-07 子任务层级', !!getTask(child.id)?.parentId, child)

const r3 = importFromText(json, 'backup.json')
check('IMP-08 JSON 条数', r3.ok && r3.tasks === 2, r3)
check('IMP-09 JSON 建清单', getLists().some((l) => l.name === '学习'), getLists().map((l) => l.name))

if (failed) {
  console.error(`\n${failed} 个导入用例失败`)
  process.exit(1)
}
console.log('\n导入全部通过')
