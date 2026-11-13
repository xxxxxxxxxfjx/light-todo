import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { addDays, format } from 'date-fns'
import {
  addTimeEntry,
  countFilter,
  countReplanActions,
  createList,
  createSavedFilter,
  createSection,
  createTask,
  deleteSection,
  getDayReview,
  getDueReminders,
  getSavedFilters,
  getSections,
  getTask,
  listOverdueTasks,
  listTasks,
  markReminderSent,
  replanTask,
  saveDayReview,
  setTaskStatus,
  updateTask
} from '../src/main/db.ts'
import { initDb } from '../src/main/db.ts'
import { parseQuickAdd } from '../src/shared/nlp.ts'
import { buildFilterSql, parseFilterText } from '../src/shared/filter-query.ts'
import { parseCaptureText } from '../src/shared/capture-parse.ts'

const now = new Date('2026-11-12T09:00:00')
const today = format(now, 'yyyy-MM-dd')
const tomorrow = format(addDays(now, 1), 'yyyy-MM-dd')
const yesterday = format(addDays(now, -1), 'yyyy-MM-dd')

// ── 快速添加操作符 ──────────────────────────────────────────
const withEstimate = parseQuickAdd('写周报 =45m #工作 !高', now)
assert.equal(withEstimate.estimateMin, 45)
assert.equal(withEstimate.listName, '工作')
assert.equal(withEstimate.priority, 3)

const withRange = parseQuickAdd('开评审会 10:00-11:30', now)
assert.equal(withRange.estimateMin, 90)
assert.equal(withRange.scheduledDate, today)
assert.equal(withRange.title.includes('开评审会'), true)

const withMarkers = parseQuickAdd('交报告 >明天 <周五', now)
assert.equal(withMarkers.scheduledDate, tomorrow)
assert.ok(withMarkers.dueAt)

const withStarTag = parseQuickAdd('整理资料 *客户 *紧急', now)
assert.deepEqual(withStarTag.tagNames.sort(), ['客户', '紧急'].sort())

// ── 截图识别结果拆分 ──────────────────────────────────────
const capture = parseCaptureText('11月13日 10:00-11:30 项目评审', now)
assert.equal(capture.title, '项目评审')
assert.equal(capture.scheduledDate, '2026-11-13')
assert.equal(capture.estimateMin, 90)
assert.equal(new Date(capture.dueAt!).getHours(), 10)

const captureOcr = parseCaptureText('1 1 月 1 3 日 10 ： 00 · 1 1 ： 30 顶 目 评 审', now)
assert.equal(captureOcr.title, '项目评审')
assert.equal(captureOcr.scheduledDate, '2026-11-13')
assert.equal(captureOcr.estimateMin, 90)

const captureDateOnly = parseCaptureText('11月20日 交季度报告', now)
assert.equal(captureDateOnly.title, '交季度报告')
assert.equal(captureDateOnly.scheduledDate, '2026-11-20')
assert.equal(captureDateOnly.dueAllDay, 1)

// ── 过滤器 AST ─────────────────────────────────────────────
const lists = [{ id: 'l1', folderId: null, name: '工作', color: null, icon: null, sortOrder: 0, isPinned: 0, archivedAt: null, createdAt: '' }]
const tags = [{ id: 't1', name: '客户', color: null }]
const parsedFilter = parseFilterText('本周的高优先级任务 #工作 @客户', lists, tags)
assert.ok(parsedFilter.query.conditions.some((c) => c.field === 'scheduled' && c.value === 'week'))
assert.ok(parsedFilter.query.conditions.some((c) => c.field === 'priority' && c.value === '3'))
assert.ok(parsedFilter.query.conditions.some((c) => c.field === 'list' && c.value === 'l1'))
assert.ok(parsedFilter.query.conditions.some((c) => c.field === 'tag' && c.value === 't1'))

const built = buildFilterSql(parsedFilter.query, {
  today,
  tomorrow,
  weekEnd: '2026-11-15',
  nowIso: now.toISOString()
})
assert.ok(built.sql.includes('t.priority'))
assert.ok(built.params.length >= 3)

// ── 数据库：分区 / 过滤器 / 收尾 / Replan / 用时 ─────────────
const dir = join(process.cwd(), '.tmp', 'qa', 'tier1')
rmSync(dir, { recursive: true, force: true })
initDb(dir)

const list = createList({ name: '客户项目' })
const section = createSection(list.id, '本周')
assert.equal(getSections(list.id).length, 1)

const sectionTask = createTask({
  title: '整理客户会议纪要',
  listId: list.id,
  sectionId: section.id,
  scheduledDate: today,
  estimateMin: 30,
  priority: 3,
  tagNames: ['客户']
})
assert.equal(getTask(sectionTask.id)?.sectionId, section.id)
assert.equal(getTask(sectionTask.id)?.estimateMin, 30)

const saved = createSavedFilter({
  name: '本周客户',
  query: { match: 'all', conditions: [{ field: 'tag', op: 'is', value: getTask(sectionTask.id)!.tags[0].id }] }
})
assert.equal(getSavedFilters().length, 1)
assert.equal(countFilter(saved.query), 1)
assert.ok(listTasks({ view: 'filter', filterId: saved.id }).some((task) => task.id === sectionTask.id))

const overtime = createTask({ title: '上周没做完的', scheduledDate: yesterday, priority: 2 })
assert.ok(listOverdueTasks(now).some((task) => task.id === overtime.id))
const moved = replanTask(overtime.id, 'today')
const actualToday = format(new Date(), 'yyyy-MM-dd')
assert.equal(moved?.scheduledDate, actualToday)
assert.equal(countReplanActions(actualToday), 1)

const timed = createTask({ title: '计时任务', scheduledDate: today })
addTimeEntry(timed.id, now.toISOString(), new Date(now.getTime() + 35 * 60000).toISOString())
assert.equal(getTask(timed.id)?.actualMin, 35)

const review = saveDayReview(today, 4, '今天不错')
assert.equal(getDayReview(today)?.rating, 4)
assert.equal(review.note, '今天不错')

deleteSection(section.id)
assert.equal(getTask(sectionTask.id)?.sectionId, null)

// ── 持续催办：首次提醒后安排下一次 ──────────────────────────
const escalate = createTask({
  title: '持续催办任务',
  scheduledDate: today,
  reminderAt: new Date(now.getTime() - 60000).toISOString(),
  reminderOffset: 0,
  escalateInterval: 15
})
assert.ok(getDueReminders(now.toISOString()).some((task) => task.id === escalate.id))
markReminderSent(escalate.id)
const escalated = getTask(escalate.id)
assert.ok(escalated?.nextEscalateAt)

// 完成后必须停止催办
setTaskStatus(escalate.id, true)
assert.equal(getTask(escalate.id)?.nextEscalateAt, null)

// 更新估时/紧急标记
updateTask(sectionTask.id, { estimateMin: 90, urgent: true })
assert.equal(getTask(sectionTask.id)?.estimateMin, 90)
assert.equal(getTask(sectionTask.id)?.urgent, true)

console.log('PASS 第一梯队：快速添加操作符 / 时间段 / 过滤器 / 分区 / Replan / 用时 / 收尾 / 持续催办')
