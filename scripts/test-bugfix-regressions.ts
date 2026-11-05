import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import * as db from '../src/main/db.ts'
import { importFromText } from '../src/main/import.ts'
import { buildMarkdown } from '../src/main/markdown.ts'
import { parseQuickAdd } from '../src/shared/nlp.ts'

function freshDb(prefix: string): string {
  const parent = join(process.cwd(), '.tmp', 'qa')
  mkdirSync(parent, { recursive: true })
  const dir = mkdtempSync(join(parent, prefix.replace(/^\./, '')))
  db.initDb(dir)
  return dir
}

// 1. 删除全部清单/任务后重启不应重新 seed，也不能因标签唯一键启动失败
{
  const dir = freshDb('.qa-bugfix-seed-')
  const raw = new DatabaseSync(join(dir, 'lighttodo.db'))
  raw.exec('DELETE FROM task_tags; DELETE FROM tasks; DELETE FROM lists; DELETE FROM folders; DELETE FROM tags;')
  raw.close()
  db.closeDb()
  db.initDb(dir)
  assert.equal(db.getLists().length, 0, '已有数据后不应重新生成演示清单')
  assert.equal(db.listTasks({ view: 'all' }).length, 0, '不应重新生成欢迎任务')
  db.closeDb()
  rmSync(dir, { recursive: true, force: true })
  console.log('PASS seed 幂等（删空后不复活演示数据）')
}

// 2. 重复链：后继实例被删除后再次完成，应重新生成
{
  freshDb('.qa-bugfix-repeat-')
  const task = db.createTask({ title: '链式重复', scheduledDate: '2026-11-05', rrule: 'FREQ=DAILY' })
  db.setTaskStatus(task.id, true)
  const first = db.getTask(task.id)!.nextOccurrenceId!
  db.deleteTask(first)
  db.setTaskStatus(task.id, false)
  db.setTaskStatus(task.id, true)
  const second = db.getTask(task.id)!.nextOccurrenceId
  assert.ok(second && second !== first, '删除后继后应重新生成下一次实例')
  assert.equal(db.getTask(second!)!.scheduledDate, '2026-11-06')
  db.closeDb()
  console.log('PASS 重复链在后继删除后可恢复')
}

// 3. 无日期的重复任务不应静默停止
{
  freshDb('.qa-bugfix-repeat-nodate-')
  const task = db.createTask({ title: '无日期重复', rrule: 'FREQ=DAILY' })
  db.setTaskStatus(task.id, true)
  assert.ok(db.getTask(task.id)!.nextOccurrenceId, '无日期重复任务也应有下一次实例')
  db.closeDb()
  console.log('PASS 无日期重复任务仍能生成下一次')
}

// 4. 深层子任务：完成/删除/恢复整棵子树
{
  freshDb('.qa-bugfix-tree-')
  const root = db.createTask({ title: '根任务' })
  const child = db.createTask({ title: '子任务', parentId: root.id })
  const grand = db.createTask({ title: '孙任务', parentId: child.id })
  db.setTaskStatus(root.id, true)
  assert.equal(db.getTask(child.id)!.status, 1, '子任务应完成')
  assert.equal(db.getTask(grand.id)!.status, 1, '孙任务应完成')
  db.setTaskStatus(root.id, false)
  // 单独先删除孙任务，再删除/恢复根任务，孙任务应仍留在回收站
  db.deleteTask(grand.id)
  db.deleteTask(root.id)
  assert.equal(db.getTask(grand.id), null, '孙任务应随根任务从列表消失')
  db.restoreTask(root.id)
  assert.ok(db.getTask(root.id), '根任务应恢复')
  assert.ok(db.getTask(child.id), '子任务应恢复')
  assert.equal(db.getTask(grand.id), null, '先前单独删除的孙任务不应被恢复')
  db.closeDb()
  console.log('PASS 深层子任务完成/删除/恢复')
}

// 5. 非法日期 / 非法重复规则在写入和导入阶段被拒绝
{
  freshDb('.qa-bugfix-validate-')
  assert.throws(() => db.createTask({ title: '坏日期', dueAt: 'not-a-date' }), /格式无效/)
  assert.throws(() => db.createTask({ title: '坏规则', rrule: 'NOT_A_RULE' }), /重复规则无效/)
  const bad = importFromText(JSON.stringify({ tasks: [{ title: '坏导入', scheduledDate: 'bad' }] }), 'bad.json')
  assert.equal(bad.ok, false)
  assert.equal(db.searchTasks('坏导入').length, 0, '导入失败应回滚')
  db.closeDb()
  console.log('PASS 非法日期/重复规则校验')
}

// 6. 同名清单导入不合并
{
  freshDb('.qa-bugfix-samename-')
  const json = JSON.stringify({
    lists: [
      { id: 'l1', name: '同名清单', color: '#111111' },
      { id: 'l2', name: '同名清单', color: '#222222' }
    ],
    tasks: [
      { id: 't1', title: '清单一', listId: 'l1' },
      { id: 't2', title: '清单二', listId: 'l2' }
    ]
  })
  const r = importFromText(json, 'same.json')
  assert.equal(r.ok, true)
  assert.equal(r.lists, 2)
  const sameName = db.getLists().filter((l) => l.name === '同名清单')
  assert.equal(sameName.length, 2)
  const one = db.searchTasks('清单一')[0]
  const two = db.searchTasks('清单二')[0]
  assert.notEqual(one.listId, two.listId, '同名清单里的任务不应被合并到同一清单')
  db.closeDb()
  console.log('PASS 同名清单导入保留结构')
}

// 7. Markdown 导出包含备注和任意深度子任务
{
  freshDb('.qa-bugfix-markdown-')
  const parent = db.createTask({ title: 'Markdown父任务', notes: '第一行\n第二行' })
  const child = db.createTask({ title: 'Markdown子任务', parentId: parent.id })
  db.createTask({ title: 'Markdown孙任务', parentId: child.id })
  const md = buildMarkdown(db.getAllData())
  assert.ok(md.includes('Markdown父任务'))
  assert.ok(md.includes('第一行') && md.includes('第二行'), '备注应导出')
  assert.ok(md.includes('Markdown子任务'))
  assert.ok(md.includes('Markdown孙任务'), '孙任务应导出')
  db.closeDb()
  console.log('PASS Markdown 导出备注与多层子任务')
}

// 8. 回收站按 30 天清理，且 ISO 时间比较正确
{
  const dir = freshDb('.qa-bugfix-trash-')
  const task = db.createTask({ title: '旧回收站任务' })
  db.deleteTask(task.id)
  const raw = new DatabaseSync(join(dir, 'lighttodo.db'))
  raw.prepare('UPDATE tasks SET deleted_at = ? WHERE id = ?').run(new Date(Date.now() - 40 * 86400000).toISOString(), task.id)
  raw.close()
  db.purgeTrash()
  assert.equal(db.getTask(task.id), null)
  db.closeDb()
  rmSync(dir, { recursive: true, force: true })
  console.log('PASS 回收站 30 天清理')
}

// 9. 设置实际截止时间后 due_all_day 归零
{
  freshDb('.qa-bugfix-dueday-')
  const task = db.createTask({ title: '全天转定时', scheduledDate: '2026-11-06', dueAllDay: 1 })
  const updated = db.updateTask(task.id, { dueAt: '2026-11-06T07:30:00.000Z' })
  assert.equal(updated.dueAllDay, 0, '设置具体时间后不应再标记为全天')
  db.closeDb()
  console.log('PASS 截止时间归一化')
}

// 10. 标签计数与标签视图口径一致（不统计子任务）
{
  freshDb('.qa-bugfix-tagcount-')
  const parent = db.createTask({ title: '标签父任务', tagNames: ['统计标签'] })
  db.createTask({ title: '标签子任务', parentId: parent.id, tagNames: ['统计标签'] })
  const tag = db.getTags().find((t) => t.name === '统计标签')!
  assert.equal(tag.count, 1, '标签计数不应包含子任务')
  assert.equal(db.listTasks({ view: 'tag', tagId: tag.id }).length, 1)
  db.closeDb()
  console.log('PASS 标签计数与视图一致')
}

// 11. NLP 边界：每月31号、每两周、显式日期标记
{
  const now = new Date(2026, 10, 2, 10, 0, 0)
  const month31 = parseQuickAdd('每月31号 交材料', now)
  assert.equal(month31.scheduledDate, '2026-12-31')
  assert.equal(month31.rrule, 'FREQ=MONTHLY;BYMONTHDAY=31')
  const biweekly = parseQuickAdd('每两周 复盘', now)
  assert.equal(biweekly.rrule, 'FREQ=WEEKLY;INTERVAL=2')
  const twoDays = parseQuickAdd('每两天 浇花', now)
  assert.equal(twoDays.rrule, 'FREQ=DAILY;INTERVAL=2')
  const explicit = parseQuickAdd('明天 开会', now)
  assert.equal(explicit.hasExplicitDate, true)
  const timeOnly = parseQuickAdd('9:00', now)
  assert.equal(timeOnly.hasExplicitDate, false)
  console.log('PASS NLP 边界（每月31号/每两周/显式日期）')
}

// 12. TickTick CSV 的“子任务”列导入为真实子任务
{
  freshDb('.qa-bugfix-csvsub-')
  const csv = '标题,子任务\n父任务,"子任务A\n子任务B"\n'
  const r = importFromText(csv, 'ticktick.csv')
  assert.equal(r.ok, true)
  const parent = db.searchTasks('父任务')[0]
  assert.ok(parent)
  assert.equal(db.getTask(parent.id)?.subtasks?.length, 2)
  assert.equal(r.tasks, 3)
  db.closeDb()
  console.log('PASS TickTick CSV 子任务列')
}

console.log('全部 Bugfix 回归通过')
