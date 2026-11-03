import { parseQuickAdd } from '../src/shared/nlp.ts'

let failed = 0
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    console.log('PASS', name)
  } else {
    failed++
    console.error('FAIL', name, detail ?? '')
  }
}

const now = new Date(2026, 10, 2, 10, 0, 0) // 2026-11-02 周一 10:00

{
  const r = parseQuickAdd('明天下午3点 交周报 #工作 @汇报 !高', now)
  check('NLP-01 标题', r.title === '交周报', r.title)
  check('NLP-02 计划日', r.scheduledDate === '2026-11-03', r.scheduledDate)
  check('NLP-03 时间', new Date(r.dueAt!).getHours() === 15, r.dueAt)
  check('NLP-04 优先级', r.priority === 3, r.priority)
  check('NLP-05 清单', r.listName === '工作', r.listName)
  check('NLP-06 标签', r.tagNames[0] === '汇报', r.tagNames)
}

{
  const r = parseQuickAdd('每周一 站会', now)
  check('NLP-07 每周一', r.rrule === 'FREQ=WEEKLY;BYDAY=MO', r.rrule)
  check('NLP-08 下一次日期', r.scheduledDate === '2026-11-02', r.scheduledDate)
}

{
  const r = parseQuickAdd('每月5号 交房租', now)
  check('NLP-09 每月5号', r.rrule === 'FREQ=MONTHLY;BYMONTHDAY=5', r.rrule)
  check('NLP-10 日期', r.scheduledDate === '2026-11-05', r.scheduledDate)
}

{
  const r = parseQuickAdd('每3天 浇花', now)
  check('NLP-11 每3天', r.rrule === 'FREQ=DAILY;INTERVAL=3', r.rrule)
}

{
  const r = parseQuickAdd('下周三 评审', now)
  check('NLP-12 下周三', r.scheduledDate === '2026-11-11', r.scheduledDate)
}

{
  const r = parseQuickAdd('今晚8点 跑步', now)
  check('NLP-13 今晚标题', r.title === '跑步', r.title)
  check('NLP-14 今晚 20 点', new Date(r.dueAt!).getHours() === 20, r.dueAt)
  check('NLP-15 今晚今天', r.scheduledDate === '2026-11-02', r.scheduledDate)
}

{
  const r = parseQuickAdd('买牛奶', now)
  check('NLP-16 无日期', r.scheduledDate === null && r.dueAt === null, r)
  check('NLP-17 标题保留', r.title === '买牛奶', r.title)
}

{
  const r = parseQuickAdd('3月5日 交材料 !中', now)
  check('NLP-18 跨年日期', r.scheduledDate === '2027-03-05', r.scheduledDate)
  check('NLP-19 中优先级', r.priority === 2, r.priority)
}

{
  const r = parseQuickAdd('每周一三五 健身 晚上7点', now)
  check('NLP-20 多星期', r.rrule === 'FREQ=WEEKLY;BYDAY=MO,WE,FR', r.rrule)
  check('NLP-21 晚上 7 点', new Date(r.dueAt!).getHours() === 19, r.dueAt)
}

{
  const r = parseQuickAdd('每月第2个周二 复盘', now)
  check('NLP-22 第2个周二', r.rrule === 'FREQ=MONTHLY;BYDAY=2TU', r.rrule)
  check('NLP-23 日期', r.scheduledDate === '2026-11-10', r.scheduledDate)
}

{
  const r = parseQuickAdd('工作日 晨会', now)
  check('NLP-24 工作日', r.rrule === 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', r.rrule)
}

if (failed) {
  console.error(`\n${failed} 个 NLP 用例失败`)
  process.exit(1)
}
console.log('\nNLP 全部通过')
