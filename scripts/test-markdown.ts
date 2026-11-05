import assert from 'node:assert/strict'
import { parseMarkdown, parseInline, toggleChecklistLine } from '../src/renderer/src/lib/markdown.ts'

const blocks = parseMarkdown(['# 标题', '', '一段 **加粗** 和 `code`，还有 [链接](https://example.com)。', '', '- 项目一', '- [ ] 步骤一', '- [x] 步骤二', '', '> 引用', '', '```ts', 'const x = 1', '```'].join('\n'))
assert.equal(blocks[0].type, 'heading')
assert.equal(blocks[0].type === 'heading' ? blocks[0].level : 0, 1)
assert.equal(blocks[1].type, 'paragraph')
const paragraph = blocks[1]
assert.ok(paragraph.type === 'paragraph' && paragraph.inlines.some((n) => n.type === 'strong' && n.text === '加粗'))
assert.ok(paragraph.type === 'paragraph' && paragraph.inlines.some((n) => n.type === 'code' && n.text === 'code'))
assert.ok(paragraph.type === 'paragraph' && paragraph.inlines.some((n) => n.type === 'link' && n.href === 'https://example.com'))
const list = blocks[2]
assert.ok(list.type === 'list' && list.items.length === 3)
assert.equal(list.type === 'list' ? list.items[1].checked : null, false)
assert.equal(list.type === 'list' ? list.items[2].checked : null, true)
assert.equal(blocks[3].type, 'quote')
assert.equal(blocks[4].type, 'code')

const toggled = toggleChecklistLine('- [ ] 步骤一\n- [x] 步骤二', 0)
assert.equal(toggled, '- [x] 步骤一\n- [x] 步骤二')
assert.equal(toggleChecklistLine('- [x] 步骤二', 0), '- [ ] 步骤二')
assert.equal(toggleChecklistLine('普通行', 0), '普通行')

// No raw HTML execution: angle brackets stay text tokens.
const inline = parseInline('<img src=x onerror=alert(1)> **安全**')
assert.ok(inline.some((n) => n.type === 'text' && n.text.includes('<img')))
assert.ok(!inline.some((n) => n.type === 'strong' && n.text.includes('<img')))
console.log('PASS Markdown 解析、清单勾选与安全降级')
