import assert from 'node:assert/strict'
import {
  TEMPLATE_LIMIT,
  addTemplate,
  parseTemplates,
  removeTemplate,
  templateName
} from '../src/renderer/src/lib/templates.ts'

assert.deepEqual(parseTemplates(null), [])
assert.deepEqual(parseTemplates('not-json'), [])
assert.deepEqual(parseTemplates('{}'), [])
assert.deepEqual(parseTemplates('[{"id":"x"}]'), [])

assert.equal(templateName('下午3点 交周报 #工作'), '下午3点 交周报 #工作')
assert.equal(templateName('a'.repeat(30)).length, 21)

let list = addTemplate([], '下午3点 交周报 #工作 @汇报 !高', new Date('2026-11-05T10:00:00'))
assert.equal(list.length, 1)
assert.equal(list[0].text.includes('#工作'), true)
const same = addTemplate(list, '下午3点 交周报 #工作 @汇报 !高', new Date('2026-11-05T10:01:00'))
assert.equal(same.length, 1, '同名模板应覆盖而不是重复')
assert.notEqual(same[0].id, list[0].id)

for (let i = 0; i < TEMPLATE_LIMIT + 5; i++) list = addTemplate(list, `模板任务 ${i}`, new Date(2026, 10, 5, 10, i))
assert.equal(list.length, TEMPLATE_LIMIT)

const removed = removeTemplate(list, list[0].id)
assert.equal(removed.length, TEMPLATE_LIMIT - 1)
assert.equal(removed.some((item) => item.id === list[0].id), false)

console.log('PASS 快速添加模板：解析/覆盖/上限/删除')
