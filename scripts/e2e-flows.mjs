/**
 * 全链路（多步骤、跨视图、跨重启）E2E。
 * 每个 journey 由多个 session 组成，session 之间应用完全退出再启动，数据目录不变。
 * 运行：node scripts/e2e-flows.mjs [journeyName]
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const ROOT = process.cwd()
const EXE = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const BASE = join(ROOT, '.e2e-flows')
const only = process.argv[2]

let failed = 0
const results = []

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function q(db, sql, ...p) {
  return db.prepare(sql).all(...p)
}
function one(db, sql, ...p) {
  return db.prepare(sql).get(...p)
}

const setText = (sel, text, kind = 'textarea') => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return 'NO_ELEMENT';
  const proto = window.${kind === 'input' ? 'HTMLInputElement' : 'HTMLTextAreaElement'}.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'OK';
})()`

const clickText = (sel, text) => `(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent?.includes(${JSON.stringify(text)}));
  if (!el) return 'NOT_FOUND';
  el.click();
  return 'CLICKED';
})()`

const addQuick = (title) => [
  { js: `document.querySelector('.new-task').click()`, wait: 300 },
  { js: setText('.qa-input', title), wait: 200 },
  { js: `document.querySelector('.qa-submit').click()`, wait: 650 }
]

const setSelectText = (index, text) => `(() => {
  const el = document.querySelectorAll('.field-value select')[${index}];
  if (!el) return 'NO_SELECT';
  const opt = [...el.options].find((o) => o.textContent.trim() === ${JSON.stringify(text)});
  if (!opt) return 'NO_OPTION';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(el, opt.value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return opt.value;
})()`

const setInput = (sel, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return 'NO_ELEMENT';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return 'OK';
})()`

async function launch(dir, steps, tag) {
  const specPath = join(dir, `spec-${tag}.json`)
  writeFileSync(specPath, JSON.stringify({ steps }, null, 2))
  const env = { ...process.env, LIGHTTODO_DATA_DIR: dir }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(EXE, ['--no-sandbox', '--disable-gpu', '.', `--e2e=${specPath}`], {
    cwd: ROOT,
    env,
    stdio: 'ignore'
  })
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      child.kill()
      reject(new Error('启动超时'))
    }, 90000)
    child.on('exit', () => {
      clearTimeout(t)
      resolve()
    })
    child.on('error', (e) => {
      clearTimeout(t)
      reject(e)
    })
  })
  const outPath = specPath.replace('.json', '.out.json')
  if (!existsSync(outPath)) throw new Error('无测试结果输出')
  const out = JSON.parse(readFileSync(outPath, 'utf8'))
  if (!out.ok) throw new Error(out.error || '脚本执行失败')
  return out
}

async function journey(name, sessions) {
  if (only && only !== name) return
  const dir = join(BASE, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const t0 = Date.now()
  try {
    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i]
      const out = await launch(dir, s.steps, `s${i + 1}`)
      const db = new DatabaseSync(join(dir, 'lighttodo.db'))
      try {
        await s.check({ out, db, dir, session: i })
      } finally {
        db.close()
      }
    }
    results.push({ name, ok: true, ms: Date.now() - t0 })
    console.log(`✅ PASS  ${name}  (${Date.now() - t0}ms)`)
  } catch (e) {
    failed++
    results.push({ name, ok: false, ms: Date.now() - t0, error: e.message })
    console.log(`❌ FAIL  ${name}  (${Date.now() - t0}ms)\n        ${e.message}`)
  }
}

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const plusDays = (n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const nextDay = (s) => {
  const d = new Date(s + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ─────────────────────────────────────────────────────────
// 旅程 1：收集 → 整理 → 执行 → 完成（跨重启）
// ─────────────────────────────────────────────────────────
await journey('flow-collect-organize-execute', [
  {
    steps: [
      ...addQuick('季度报告'),
      ...addQuick('买咖啡豆'),
      ...addQuick('预约体检'),
      { js: clickText('.task-title', '季度报告'), wait: 600 },
      { js: setSelectText(0, '工作'), wait: 600 },
      { js: `document.querySelector('.seg[data-p="3"]')?.click()`, wait: 500 },
      { js: setInput('.field-value input[type=date]', today()), wait: 600 },
      { js: setText('.subtask-add input', '收集数据', 'input'), wait: 200 },
      { js: `document.querySelector('.subtask-add-btn')?.click()`, wait: 700 }
    ],
    check: ({ db }) => {
      const t = one(db, `SELECT * FROM tasks WHERE title='季度报告'`)
      assert(!!t, '任务不存在')
      const work = one(db, `SELECT * FROM lists WHERE name='工作'`)
      assert(t.list_id === work.id, '未归入工作清单')
      assert(t.priority === 3, '优先级不是高')
      assert(t.scheduled_date === today(), `计划日错误: ${t.scheduled_date}`)
      const sub = one(db, `SELECT * FROM tasks WHERE title='收集数据'`)
      assert(!!sub && sub.parent_id === t.id, '子任务未挂到父任务')
    }
  },
  {
    steps: [
      { js: clickText('.nav-item', '今天'), wait: 700 },
      { js: `[...document.querySelectorAll('.task-title')].map((e) => e.textContent)`, wait: 100 },
      { js: clickText('.task-title', '季度报告'), wait: 600 },
      { js: `document.querySelector('.subtask .check')?.click()`, wait: 700 },
      { js: `[...document.querySelectorAll('.task-row')].find((r) => r.textContent.includes('季度报告'))?.querySelector('.check')?.click()`, wait: 900 },
      { js: clickText('.nav-item', '已完成'), wait: 700 },
      { js: `[...document.querySelectorAll('.task-title')].map((e) => e.textContent)`, wait: 100 }
    ],
    check: ({ out, db }) => {
      const todayRows = out.results[1].join('|')
      assert(todayRows.includes('季度报告'), '今天视图没有该任务')
      const doneRows = out.results.at(-1).join('|')
      assert(doneRows.includes('季度报告'), '已完成视图没有该任务')
      const t = one(db, `SELECT * FROM tasks WHERE title='季度报告'`)
      assert(t.status === 1, '任务未完成')
      const sub = one(db, `SELECT * FROM tasks WHERE title='收集数据'`)
      assert(sub.status === 1, '子任务未完成')
      const inbox = q(db, `SELECT * FROM tasks WHERE list_id IS NULL AND deleted_at IS NULL AND status=0`)
      assert(inbox.length === 4, `收件箱剩余应为 4（5 条收集 - 1 条移入工作），实际 ${inbox.length}`)
    }
  }
])

// ─────────────────────────────────────────────────────────
// 旅程 2：重复任务连续两轮（跨重启）
// ─────────────────────────────────────────────────────────
await journey('flow-recurring-two-rounds', [
  {
    steps: [
      ...addQuick('每天 9点 站会'),
      { js: clickText('.nav-item', '全部'), wait: 700 },
      {
        js: `[...document.querySelectorAll('.task-row')].find((r) => r.textContent.includes('站会'))?.querySelector('.check')?.click()`,
        wait: 900
      }
    ],
    check: ({ db }) => {
      const all = q(db, `SELECT * FROM tasks WHERE title='站会' ORDER BY scheduled_date`)
      assert(all.length === 2, `第一轮后应有 2 条，实际 ${all.length}`)
      assert(all[0].status === 1 && all[1].status === 0, '状态不正确')
      assert(
        all[1].scheduled_date === nextDay(all[0].scheduled_date),
        `下一次日期应比第一次晚 1 天: ${all[0].scheduled_date} → ${all[1].scheduled_date}`
      )
    }
  },
  {
    steps: [
      { js: clickText('.nav-item', '全部'), wait: 600 },
      {
        js: `[...document.querySelectorAll('.task-row')].find((r) => r.textContent.includes('站会'))?.querySelector('.check')?.click()`,
        wait: 900
      }
    ],
    check: ({ db }) => {
      const all = q(db, `SELECT * FROM tasks WHERE title='站会' ORDER BY scheduled_date`)
      assert(all.length === 3, `两轮后应有 3 条，实际 ${all.length}`)
      assert(all.filter((t) => t.status === 1).length === 2, '应完成 2 条')
      assert(
        all[2].scheduled_date === nextDay(all[1].scheduled_date),
        `第三条应再晚 1 天: ${all[1].scheduled_date} → ${all[2].scheduled_date}`
      )
      assert(all[2].rrule?.includes('FREQ=DAILY'), '重复规则丢失')
    }
  }
])

// ─────────────────────────────────────────────────────────
// 旅程 3：清单创建 → 添加任务 → 删除清单 → 任务回落收件箱
// ─────────────────────────────────────────────────────────
await journey('flow-list-lifecycle', [
  {
    steps: [
      { js: `document.querySelector('.sb-section-head .icon-btn')?.click()`, wait: 400 },
      { js: setText('.inline-input', '临时项目', 'input'), wait: 200 },
      { js: `document.querySelector('.inline-input')?.blur()`, wait: 800 },
      { js: clickText('.list-item', '临时项目'), wait: 600 },
      ...addQuick('临时任务'),
      {
        js: `[...document.querySelectorAll('.list-row')].find((r) => r.textContent.includes('临时项目'))?.querySelector('.list-more')?.click()`,
        wait: 500
      },
      { js: `(() => { window.confirm = () => true; return 'OK' })()`, wait: 50 },
      { js: clickText('.list-actions button', '删除'), wait: 900 },
      { js: `document.querySelectorAll('.list-item').length`, wait: 100 }
    ],
    check: ({ db }) => {
      assert(!one(db, `SELECT * FROM lists WHERE name='临时项目'`), '清单应已删除')
      const t = one(db, `SELECT * FROM tasks WHERE title='临时任务'`)
      assert(!!t, '任务不应被删除')
      assert(t.list_id === null, `任务应回落到收件箱，实际 list_id=${t.list_id}`)
    }
  }
])

// ─────────────────────────────────────────────────────────
// 旅程 4：搜索 → 打开 → 移动清单 → 计数联动
// ─────────────────────────────────────────────────────────
await journey('flow-search-move-counts', [
  {
    steps: [
      { js: clickText('.list-item', '工作'), wait: 600 },
      ...addQuick('季度复盘报告'),
      { js: `document.querySelector('.titlebar-search').click()`, wait: 400 },
      { js: setText('.search-input-row input', '季度复盘', 'input'), wait: 700 },
      { js: `[...document.querySelectorAll('.search-row')].map((e) => e.textContent)`, wait: 100 },
      { js: `document.querySelector('.search-row')?.click()`, wait: 700 },
      { js: setSelectText(0, '生活'), wait: 800 }
    ],
    check: ({ out, db }) => {
      const searchRows = out.results[6].join('|')
      assert(searchRows.includes('季度复盘报告'), '搜索结果没有命中')
      const t = one(db, `SELECT * FROM tasks WHERE title='季度复盘报告'`)
      const life = one(db, `SELECT * FROM lists WHERE name='生活'`)
      assert(t.list_id === life.id, '任务未移动到生活清单')
      assert(one(db, `SELECT * FROM tasks WHERE title='季度复盘报告' AND deleted_at IS NULL`), '任务丢失')
    }
  }
])

// ─────────────────────────────────────────────────────────
// 旅程 5：跨月日历 → 月视图找到任务 → 打开详情
// ─────────────────────────────────────────────────────────
await journey('flow-calendar-next-month', [
  {
    steps: [
      ...addQuick('12月15日 年度复盘'),
      { js: clickText('.nav-item', '日历'), wait: 800 },
      { js: `document.querySelectorAll('.cal-nav .icon-btn')[1]?.click()`, wait: 800 },
      { js: `[...document.querySelectorAll('.cal-item')].map((e) => e.textContent)`, wait: 100 },
      { js: clickText('.cal-item', '年度复盘'), wait: 700 },
      { js: `document.querySelector('.detail-title')?.value ?? document.querySelector('.detail-title')?.textContent ?? ''`, wait: 100 }
    ],
    check: ({ out, db }) => {
      const items = out.results[5].join('|')
      assert(items.includes('年度复盘'), '下个月日历没有任务: ' + items)
      const t = one(db, `SELECT * FROM tasks WHERE title='年度复盘'`)
      assert(t.scheduled_date === '2026-12-15', `日期错误: ${t.scheduled_date}`)
    }
  }
])

// ─────────────────────────────────────────────────────────
// 旅程 6：删除 → 回收站 → 恢复 → 再删除 → 彻底删除
// ─────────────────────────────────────────────────────────
await journey('flow-trash-cycle', [
  {
    steps: [
      ...addQuick('回收链任务'),
      { js: clickText('.task-title', '回收链任务'), wait: 500 },
      { js: `document.querySelector('.danger-btn').click()`, wait: 700 },
      { js: clickText('.nav-item', '回收站'), wait: 700 },
      { js: clickText('.trash-row', '回收链任务'), wait: 200 },
      { js: `document.querySelector('.trash-row .mini-btn')?.click()`, wait: 800 },
      { js: clickText('.nav-item', '今天'), wait: 600 },
      { js: clickText('.task-title', '回收链任务'), wait: 500 },
      { js: `document.querySelector('.danger-btn').click()`, wait: 700 },
      { js: clickText('.nav-item', '回收站'), wait: 700 },
      { js: `(() => { window.confirm = () => true; return 'OK' })()`, wait: 50 },
      { js: `document.querySelector('.trash-row .danger-btn')?.click()`, wait: 900 }
    ],
    check: ({ db }) => {
      const t = one(db, `SELECT * FROM tasks WHERE title='回收链任务'`)
      assert(!t, '彻底删除后数据库不应再有记录')
    }
  }
])

// ─────────────────────────────────────────────────────────
// 旅程 7：边界输入（空标题 / XSS / 超长 / 通配符搜索）
// ─────────────────────────────────────────────────────────
await journey('flow-edge-inputs', [
  {
    steps: [
      { js: `(() => { window.__alerted = false; window.alert = () => { window.__alerted = true }; return 'OK' })()`, wait: 50 },
      { js: `document.querySelector('.new-task').click()`, wait: 300 },
      { js: `document.querySelector('.qa-submit').click()`, wait: 500 },
      { js: `document.querySelectorAll('.task-row').length`, wait: 100 },
      { js: setText('.qa-input', '<script>alert(1)</script>危险标题'), wait: 200 },
      { js: `document.querySelector('.qa-submit').click()`, wait: 700 },
      { js: `document.querySelectorAll('.task-title script').length`, wait: 100 },
      { js: `window.__alerted`, wait: 100 },
      { js: `document.querySelector('.new-task').click()`, wait: 300 },
      { js: setText('.qa-input', 'A'.repeat(300)), wait: 200 },
      { js: `document.querySelector('.qa-submit').click()`, wait: 700 },
      { js: `document.querySelector('.titlebar-search').click()`, wait: 400 },
      { js: setText('.search-input-row input', '%', 'input'), wait: 700 },
      { js: `document.querySelectorAll('.search-row').length`, wait: 100 }
    ],
    check: ({ out, db }) => {
      assert(out.results[3] === 3, `空标题不应新增任务，实际行数 ${out.results[3]}`)
      assert(out.results[6] === 0, '标题中的 script 被当成 DOM 插入了')
      assert(out.results[7] === false, '页面执行了注入脚本')
      const xss = one(db, `SELECT * FROM tasks WHERE title LIKE '%危险标题%'`)
      assert(!!xss && xss.title.startsWith('<script>'), 'XSS 标题未按纯文本保存')
      const long = one(db, `SELECT * FROM tasks WHERE title = ?`, 'A'.repeat(300))
      assert(!!long, '300 字标题未保存')
      assert(out.results[13] === 0, `搜索 % 应无结果（通配符需转义），实际 ${out.results[13]}`)
    }
  }
])

// ─────────────────────────────────────────────────────────
// 旅程 8：全字段持久化（跨重启 + 详情页回显）
// ─────────────────────────────────────────────────────────
await journey('flow-full-fields-persist', [
  {
    steps: [
      ...addQuick('全字段任务 #工作 @标签A !高'),
      { js: clickText('.task-title', '全字段任务'), wait: 800 },
      { js: `(() => {
        const el = document.querySelector('.notes');
        if (!el) return 'NO_ELEMENT';
        el.focus();
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(el, '备注内容第一行');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return 'OK';
      })()`, wait: 500 },
      { js: `(() => { document.querySelector('.notes')?.blur(); return 'OK' })()`, wait: 1000 },
      { js: setInput('.field-value input[type=date]', today()), wait: 700 },
      { js: setInput('.field-value input[type=datetime-local]', `${today()}T15:30`), wait: 800 },
      { js: setSelectText(1, '提前 15 分钟'), wait: 800 },
      { js: setText('.subtask-add input', '子项A', 'input'), wait: 300 },
      { js: `document.querySelector('.subtask-add-btn')?.click()`, wait: 900 }
    ],
    check: ({ db }) => {
      const t = one(db, `SELECT * FROM tasks WHERE title='全字段任务'`)
      assert(!!t, '任务不存在')
      assert(t.notes === '备注内容第一行', `备注错误: ${t.notes}`)
      assert(t.priority === 3, '优先级错误')
      assert(t.scheduled_date === today(), '计划日错误')
      assert(!!t.due_at, '截止时间未保存')
      assert(t.reminder_offset === 15, `提醒错误: ${t.reminder_offset}`)
      const sub = one(db, `SELECT * FROM tasks WHERE title='子项A'`)
      assert(!!sub && sub.parent_id === t.id, '子任务缺失')
    }
  },
  {
    steps: [
      { js: clickText('.nav-item', '全部'), wait: 700 },
      { js: clickText('.task-title', '全字段任务'), wait: 700 },
      { js: `document.querySelector('.detail-title')?.value ?? ''`, wait: 100 },
      { js: `document.querySelector('.notes')?.value ?? ''`, wait: 100 },
      { js: `[...document.querySelectorAll('.field-value select')].map((e) => e.value)`, wait: 100 },
      { js: `document.querySelector('.segmented .seg.active')?.textContent ?? ''`, wait: 100 },
      { js: `[...document.querySelectorAll('.subtask')].map((e) => e.textContent)`, wait: 100 }
    ],
    check: ({ out }) => {
      assert(String(out.results[2]).includes('全字段任务'), '详情标题未回显')
      assert(String(out.results[3]).includes('备注内容第一行'), '备注未回显')
      const selects = out.results[4]
      assert(selects[1] === '15', `提醒未回显: ${selects[1]}`)
      assert(String(out.results[5]).includes('高'), '优先级未回显')
      assert(out.results[6].join('|').includes('子项A'), '子任务未回显')
    }
  }
])

// ─────────────────────────────────────────────────────────
console.log('\n================ 全链路汇总 ================')
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  ${r.ms}ms`)
console.log(`总计 ${results.length}，失败 ${failed}`)
process.exit(failed ? 1 : 0)
