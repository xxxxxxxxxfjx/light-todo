/**
 * 轻单 E2E 回归：启动真实 Electron 窗口，用脚本驱动 UI，退出后直接查 SQLite 断言。
 * 运行：node scripts/e2e.mjs [scenarioName]
 */
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const ROOT = process.cwd()
const EXE = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const E2E_DIR = join(ROOT, '.e2e')
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'

const only = process.argv[2]

const results = []
let failed = 0

function assert(cond, msg) {
  if (!cond) throw new Error('断言失败: ' + msg)
}

function q(db, sql, ...params) {
  return db.prepare(sql).all(...params)
}

function one(db, sql, ...params) {
  return db.prepare(sql).get(...params)
}

const setText = (selector, text, kind = 'textarea') => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return 'NO_ELEMENT';
  const proto = window.${kind === 'input' ? 'HTMLInputElement' : 'HTMLTextAreaElement'}.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'OK';
})()`

const clickText = (selector, text) => `(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent?.includes(${JSON.stringify(text)}));
  if (!el) return 'NOT_FOUND';
  el.click();
  return 'CLICKED';
})()`

const rows = `[...document.querySelectorAll('.task-title')].map((e) => e.textContent)`

async function runScenario(name, steps, check, opts = {}) {
  if (only && only !== name) return
  if (opts.setup) await opts.setup()
  const dir = join(E2E_DIR, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const specPath = join(dir, 'spec.json')
  writeFileSync(specPath, JSON.stringify({ steps }, null, 2))

  const env = { ...process.env, LIGHTTODO_DATA_DIR: dir }
  delete env.ELECTRON_RUN_AS_NODE
  const packaged = opts.packaged ?? process.env.E2E_PACKAGED === '1'
  const args = packaged
    ? ['--no-sandbox', '--disable-gpu', `--e2e=${specPath}`]
    : ['--no-sandbox', '--disable-gpu', '.', `--e2e=${specPath}`]
  if (opts.args) args.push(...opts.args)
  const exe = packaged ? join(ROOT, 'release', 'win-unpacked', 'LightTodo.exe') : EXE

  const started = Date.now()
  const child = spawn(exe, args, { cwd: ROOT, env, stdio: 'ignore' })
  const timeout = opts.timeout ?? 90000
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        child.kill()
        reject(new Error('超时 ' + timeout + 'ms'))
      }, timeout)
      child.on('exit', () => {
        clearTimeout(t)
        resolve()
      })
      child.on('error', (e) => {
        clearTimeout(t)
        reject(e)
      })
    })

    const outPath = specPath.replace(/\.json$/, '.out.json')
    if (!existsSync(outPath)) throw new Error('没有生成测试结果文件')
    const out = JSON.parse(readFileSync(outPath, 'utf8'))
    if (!out.ok) throw new Error(out.error || '应用内脚本执行失败')

    const db = new DatabaseSync(join(dir, 'lighttodo.db'))
    await check({ out, db, dir })
    db.close()
    const ms = Date.now() - started
    results.push({ name, ok: true, ms })
    console.log(`✅ PASS  ${name}  (${ms}ms)`)
  } catch (e) {
    failed++
    const ms = Date.now() - started
    results.push({ name, ok: false, ms, error: String(e.message ?? e) })
    console.log(`❌ FAIL  ${name}  (${ms}ms)\n        ${e.message ?? e}`)
  } finally {
    if (opts.teardown) {
      try {
        await opts.teardown()
      } catch {
        /* ignore */
      }
    }
  }
}

// ── 场景 ────────────────────────────────────────────────

await runScenario('first-run', [{ js: rows, wait: 200 }], ({ out }) => {
  const titles = out.results[0]
  assert(titles.length === 3, `首启应有 3 条引导任务，实际 ${titles.length}`)
  assert(titles.some((t) => t.includes('欢迎使用轻单')), '缺少欢迎任务')
})

await runScenario(
  'add-unfiled',
  [
    { js: `document.querySelector('.new-task').click()`, wait: 300 },
    { js: setText('.qa-input', '无清单新增任务'), wait: 200 },
    { js: `document.querySelector('.qa-submit').click()`, wait: 700 },
    { js: rows, wait: 100 }
  ],
  ({ out, db }) => {
    const t = one(db, `SELECT * FROM tasks WHERE title = ?`, '无清单新增任务')
    assert(!!t, '任务没有写入数据库')
    assert(t.list_id === null, '无清单任务不应归属清单')
    assert(out.results.at(-1).includes('无清单新增任务'), '列表里没有显示新任务')
  }
)

await runScenario(
  'add-in-list',
  [
    { js: clickText('.list-item', '工作'), wait: 500 },
    { js: `document.querySelector('.new-task').click()`, wait: 300 },
    { js: setText('.qa-input', '清单内新增任务'), wait: 200 },
    { js: `document.querySelector('.qa-submit').click()`, wait: 700 },
    { js: rows, wait: 100 }
  ],
  ({ out, db }) => {
    const work = one(db, `SELECT * FROM lists WHERE name = '工作'`)
    const t = one(db, `SELECT * FROM tasks WHERE title = ?`, '清单内新增任务')
    assert(!!t, '任务没有写入数据库')
    assert(t.list_id === work.id, `任务应归属工作清单，实际 list_id=${t.list_id}`)
    const unfiled = q(db, `SELECT * FROM tasks WHERE list_id IS NULL AND deleted_at IS NULL AND status = 0`)
    assert(unfiled.length === 2, `无清单任务数不符，实际 ${unfiled.length} 条`)
    assert(out.results.at(-1).includes('清单内新增任务'), '工作清单视图里没有显示')
  }
)

await runScenario(
  'new-task-on-top',
  [
    { js: `document.querySelector('.new-task').click()`, wait: 300 },
    { js: setText('.qa-input', '第一条任务'), wait: 200 },
    { js: `document.querySelector('.qa-submit').click()`, wait: 600 },
    { js: `document.querySelector('.new-task').click()`, wait: 300 },
    { js: setText('.qa-input', '第二条任务'), wait: 200 },
    { js: `document.querySelector('.qa-submit').click()`, wait: 600 },
    { js: rows, wait: 100 }
  ],
  ({ out }) => {
    const list = out.results.at(-1)
    const i1 = list.indexOf('第一条任务')
    const i2 = list.indexOf('第二条任务')
    assert(i1 >= 0 && i2 >= 0, '两条任务都应存在')
    assert(i2 < i1, `新任务应排最上面，实际顺序: ${list.join(' | ')}`)
  }
)

await runScenario(
  'add-nlp',
  [
    { js: `document.querySelector('.new-task').click()`, wait: 300 },
    { js: setText('.qa-input', '明天下午3点 交周报 #工作 @汇报 !高'), wait: 300 },
    { js: `[...document.querySelectorAll('.qa-chip')].map((e) => e.textContent)`, wait: 100 },
    { js: `document.querySelector('.qa-submit').click()`, wait: 700 }
  ],
  ({ out, db }) => {
    const chips = out.results[2].join('|')
    for (const c of ['明天', '15:00', '高优先级', '工作', '汇报']) {
      assert(chips.includes(c), `解析 chips 缺少「${c}」，实际: ${chips}`)
    }
    const t = one(db, `SELECT * FROM tasks WHERE title = ?`, '交周报')
    assert(!!t, '任务没有写入')
    assert(t.priority === 3, `优先级应为 3，实际 ${t.priority}`)
    const work = one(db, `SELECT * FROM lists WHERE name = '工作'`)
    assert(t.list_id === work.id, '应归属工作清单')
    const tag = one(
      db,
      `SELECT tg.name FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.task_id = ?`,
      t.id
    )
    assert(tag?.name === '汇报', '标签应为「汇报」')
    const d = new Date(t.due_at)
    assert(d.getHours() === 15, `截止时间应为 15 点，实际 ${d.getHours()}`)
  }
)

await runScenario(
  'complete-task',
  [
    { js: `document.querySelector('.task-row .check').click()`, wait: 800 }
  ],
  ({ db }) => {
    const done = q(db, `SELECT * FROM tasks WHERE status = 1 AND completed_at IS NOT NULL`)
    assert(done.length === 1, `应有 1 条已完成任务，实际 ${done.length}`)
  }
)

await runScenario(
  'delete-to-trash',
  [
    { js: `document.querySelector('.new-task').click()`, wait: 300 },
    { js: setText('.qa-input', '待删除任务'), wait: 200 },
    { js: `document.querySelector('.qa-submit').click()`, wait: 600 },
    { js: clickText('.task-title', '待删除任务'), wait: 400 },
    { js: `document.querySelector('.danger-btn').click()`, wait: 700 }
  ],
  ({ db }) => {
    const t = one(db, `SELECT * FROM tasks WHERE title = '待删除任务'`)
    assert(!!t, '任务应仍在数据库中（软删除）')
    assert(!!t.deleted_at, '应写入 deleted_at 字段')
    const visible = q(db, `SELECT * FROM tasks WHERE title = '待删除任务' AND deleted_at IS NULL`)
    assert(visible.length === 0, '删除后不应出现在正常查询里')
  }
)

await runScenario(
  'search',
  [
    { js: `document.querySelector('.new-task').click()`, wait: 300 },
    { js: setText('.qa-input', '独一无二的检索词'), wait: 200 },
    { js: `document.querySelector('.qa-submit').click()`, wait: 600 },
    { js: `document.querySelector('.titlebar-search').click()`, wait: 300 },
    { js: setText('.search-input-row input', '独一无二', 'input'), wait: 700 },
    { js: `[...document.querySelectorAll('.search-row')].map((e) => e.textContent)`, wait: 100 }
  ],
  ({ out }) => {
    const list = out.results.at(-1).join('|')
    assert(list.includes('独一无二的检索词'), `搜索结果缺失，实际: ${list}`)
  }
)

await runScenario(
  'calendar',
  [
    { js: clickText('.nav-item', '日历'), wait: 800 },
    { js: `document.querySelectorAll('.cal-cell').length`, wait: 100 },
    { js: `document.querySelectorAll('.cal-item').length`, wait: 100 },
    { js: `document.querySelectorAll('.agenda-row').length`, wait: 100 }
  ],
  ({ out }) => {
    assert(out.results[1] >= 28 && out.results[1] % 7 === 0, `月历格数异常，实际 ${out.results[1]}`)
    assert(out.results[2] >= 1, `月格应展示任务预览，实际 ${out.results[2]}`)
    assert(out.results[3] >= 3, `当天列表应展示全部任务，实际 ${out.results[3]}`)
  }
)

await runScenario(
  'settings-backup',
  [
    { js: `document.querySelector('.sb-foot .nav-item').click()`, wait: 500 },
    { js: clickText('.mini-btn', '立即备份'), wait: 1200 }
  ],
  ({ dir }) => {
    const backupDir = join(dir, 'backups')
    assert(existsSync(backupDir), '备份目录不存在')
    const files = readdirSync(backupDir).filter((f) => f.endsWith('.db'))
    assert(files.length >= 1, '没有生成备份文件')
  }
)

await runScenario(
  'recurrence',
  [
    { js: `document.querySelector('.new-task').click()`, wait: 300 },
    { js: setText('.qa-input', '每天 站会'), wait: 300 },
    { js: `document.querySelector('.qa-submit').click()`, wait: 700 },
    {
      js: `[...document.querySelectorAll('.task-row')].find((r) => r.textContent.includes('站会'))?.querySelector('.check')?.click()`,
      wait: 900
    }
  ],
  ({ db }) => {
    const all = q(db, `SELECT * FROM tasks WHERE title = '站会' ORDER BY created_at`)
    assert(all.length === 2, `重复任务完成后应有 2 条记录（旧+新），实际 ${all.length}`)
    const oldOne = all.find((t) => t.status === 1)
    const next = all.find((t) => t.status === 0)
    assert(!!oldOne, '旧任务应为已完成')
    assert(!!next, '应生成下一次任务')
    assert(!!next.rrule && next.rrule.includes('FREQ=DAILY'), '下一次应保留重复规则')
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const expect = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
    assert(next.scheduled_date === expect, `下一次应在明天（${expect}），实际 ${next.scheduled_date}`)
  }
)

await runScenario(
  'subtask',
  [
    { js: `document.querySelector('.task-row').click()`, wait: 500 },
    { js: setText('.subtask-add input', '子任务一', 'input'), wait: 200 },
    { js: `document.querySelector('.subtask-add-btn')?.click()`, wait: 800 }
  ],
  ({ db }) => {
    const child = one(db, `SELECT * FROM tasks WHERE title = '子任务一'`)
    assert(!!child, '子任务没有写入')
    assert(!!child.parent_id, '子任务应带 parent_id')
  }
)

await runScenario(
  'trash-restore',
  [
    { js: `document.querySelector('.new-task').click()`, wait: 300 },
    { js: setText('.qa-input', '可恢复任务'), wait: 200 },
    { js: `document.querySelector('.qa-submit').click()`, wait: 650 },
    { js: clickText('.task-title', '可恢复任务'), wait: 400 },
    { js: `document.querySelector('.danger-btn').click()`, wait: 600 },
    { js: clickText('.nav-item', '回收站'), wait: 600 },
    { js: `[...document.querySelectorAll('.trash-row')].map((e) => e.textContent)`, wait: 100 },
    { js: `document.querySelector('.trash-row .mini-btn')?.click()`, wait: 700 }
  ],
  ({ out, db }) => {
    const trashText = out.results[6].join('|')
    assert(trashText.includes('可恢复任务'), '回收站里应显示已删除任务: ' + trashText)
    const t = one(db, `SELECT * FROM tasks WHERE title = '可恢复任务'`)
    assert(!!t, '任务不应被硬删除')
    assert(!t.deleted_at, '恢复后 deleted_at 应为空')
  }
)

await runScenario(
  'list-rename',
  [
    {
      js: `[...document.querySelectorAll('.list-row')].find((r) => r.textContent.includes('工作'))?.querySelector('.list-more')?.click()`,
      wait: 600
    },
    { js: clickText('.list-actions button', '重命名'), wait: 600 },
    { js: setText('.list-row .inline-input', '工作改名', 'input'), wait: 400 },
    { js: `document.querySelector('.list-row .inline-input')?.blur()`, wait: 1200 }
  ],
  ({ db }) => {
    const l = one(db, `SELECT * FROM lists WHERE name = '工作改名'`)
    assert(!!l, '清单改名没有写入数据库，现有清单: ' + q(db, 'SELECT name FROM lists').map((x) => x.name).join(','))
  }
)

await runScenario(
  'filter-high',
  [
    { js: `document.querySelector('.new-task').click()`, wait: 300 },
    { js: setText('.qa-input', '!高 高优先级测试'), wait: 200 },
    { js: `document.querySelector('.qa-submit').click()`, wait: 600 },
    { js: `document.querySelector('.new-task').click()`, wait: 300 },
    { js: setText('.qa-input', '普通任务测试'), wait: 200 },
    { js: `document.querySelector('.qa-submit').click()`, wait: 600 },
    {
      js: `[...document.querySelectorAll('.filter-chip')].find((e) => e.textContent === '高优先级')?.click()`,
      wait: 400
    },
    { js: rows, wait: 100 }
  ],
  ({ out }) => {
    const list = out.results.at(-1).join('|')
    assert(list.includes('高优先级测试'), '筛选后应包含高优先级任务: ' + list)
    assert(!list.includes('普通任务测试'), '筛选后不应包含普通任务: ' + list)
  }
)

await runScenario(
  'reminder-ui',
  [
    { js: clickText('.task-title', '欢迎使用轻单'), wait: 800 },
    {
      js: `(() => {
        const el = document.querySelectorAll('.field-value select')[1];
        if (!el) return 'NO_SELECT';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(el, '15');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return 'OK';
      })()`,
      wait: 900
    }
  ],
  ({ db }) => {
    const t = one(db, `SELECT * FROM tasks WHERE title = '欢迎使用轻单 👋'`)
    assert(!!t, '应找到被选中的任务')
    assert(t.reminder_offset === 15, `提醒偏移应为 15，实际 ${t.reminder_offset}`)
    assert(!!t.reminder_at, '应计算出 reminder_at')
  }
)

await runScenario(
  'shortcut-delete',
  [
    { js: `document.querySelector('.new-task').click()`, wait: 300 },
    { js: setText('.qa-input', '快捷键删除任务'), wait: 200 },
    { js: `document.querySelector('.qa-submit').click()`, wait: 600 },
    { js: clickText('.task-title', '快捷键删除任务'), wait: 400 },
    {
      js: `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))`,
      wait: 700
    }
  ],
  ({ db }) => {
    const t = one(db, `SELECT * FROM tasks WHERE title = '快捷键删除任务'`)
    assert(!!t && !!t.deleted_at, 'Delete 快捷键应把任务移到回收站')
  }
)

await runScenario(
  'url-scheme',
  [
    { js: `new Promise((r) => setTimeout(() => r(document.querySelector('.qa-input')?.value ?? ''), 2400))`, wait: 500 }
  ],
  ({ out }) => {
    const v = String(out.results[0] ?? '')
    assert(v.includes('协议测试'), 'lighttodo:// 协议没有把文本带进快速添加，实际: ' + v)
  },
  { args: ['lighttodo://add?text=协议测试'] }
)

await runScenario(
  'nav-views',
  [
    { js: `[...document.querySelectorAll('.nav-item')].map((e) => e.textContent.trim())`, wait: 100 },
    { js: clickText('.nav-item', '全部'), wait: 600 },
    { js: `document.querySelector('.new-task').click()`, wait: 300 },
    { js: setText('.qa-input', '全部默认排期任务'), wait: 200 },
    { js: `document.querySelector('.qa-submit').click()`, wait: 700 },
    { js: clickText('.nav-item', '今天'), wait: 700 },
    { js: rows, wait: 100 }
  ],
  ({ out, db }) => {
    const nav = out.results[0].join('|')
    assert(nav.includes('今天') && nav.includes('回收站'), '侧边栏视图不完整: ' + nav)
    assert(out.results.at(-1).includes('全部默认排期任务'), '全部默认排期任务应出现在今天视图')
    const t = one(db, `SELECT * FROM tasks WHERE title='全部默认排期任务'`)
    const now = new Date()
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    assert(t.list_id === null && t.scheduled_date === expected, `无日期新增任务应默认排到今天，实际 ${t.scheduled_date}`)
  }
)

await runScenario(
  'calendar-add-day',
  [
    { js: clickText('.nav-item', '日历'), wait: 800 },
    {
      js: `(() => {
        const cell = [...document.querySelectorAll('.cal-cell')].find((c) => !c.classList.contains('dim') && c.querySelector('.cal-date > span')?.textContent === '15');
        if (!cell) return 'NO_CELL';
        cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        return 'CLICKED';
      })()`,
      wait: 500
    },
    { js: `document.querySelector('.qa-input')?.value ?? ''`, wait: 100 },
    { js: setText('.qa-input', '日历点选任务'), wait: 200 },
    { js: `document.querySelector('.qa-submit')?.click()`, wait: 800 }
  ],
  ({ db }) => {
    const t = one(db, `SELECT * FROM tasks WHERE title='日历点选任务'`)
    assert(!!t, '任务未创建')
    const now = new Date()
    const expect = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`
    assert(t.scheduled_date === expect, `应排在 ${expect}，实际 ${t.scheduled_date}`)
  }
)

await runScenario(
  'detail-complete-calendar',
  [
    { js: `document.querySelector('.new-task').click()`, wait: 300 },
    { js: setText('.qa-input', '日历完成测试'), wait: 200 },
    { js: `document.querySelector('.qa-submit').click()`, wait: 700 },
    { js: clickText('.nav-item', '日历'), wait: 800 },
    { js: clickText('.agenda-task', '日历完成测试'), wait: 700 },
    { js: `document.querySelector('.detail-title-row .check.big')?.click()`, wait: 1000 },
    { js: `[...document.querySelectorAll('.cal-item')].map((e) => e.textContent)`, wait: 100 }
  ],
  ({ out, db }) => {
    const items = out.results.at(-1).join('|')
    assert(!items.includes('日历完成测试'), '完成后日历不应再显示: ' + items)
    const t = one(db, `SELECT * FROM tasks WHERE title='日历完成测试'`)
    assert(t.status === 1, '任务应已完成')
  }
)

await runScenario(
  'batch-delete',
  [
    { js: `document.querySelector('.new-task').click()`, wait: 300 },
    { js: setText('.qa-input', '批量A'), wait: 200 },
    { js: `document.querySelector('.qa-submit').click()`, wait: 600 },
    { js: `document.querySelector('.new-task').click()`, wait: 300 },
    { js: setText('.qa-input', '批量B'), wait: 200 },
    { js: `document.querySelector('.qa-submit').click()`, wait: 600 },
    { js: clickText('.head-actions .ghost-btn', '多选'), wait: 400 },
    { js: clickText('.task-row', '批量A'), wait: 200 },
    { js: clickText('.task-row', '批量B'), wait: 200 },
    { js: `document.querySelector('.bulk-bar')?.textContent ?? ''`, wait: 100 },
    { js: `[...document.querySelectorAll('.bulk-bar .mini-btn')].find((b) => b.textContent.trim() === '删除')?.click()`, wait: 1000 }
  ],
  ({ out, db }) => {
    assert(String(out.results[9]).includes('已选 2 项'), '批量栏应显示已选 2 项: ' + out.results[9])
    const a = one(db, `SELECT * FROM tasks WHERE title='批量A'`)
    const b = one(db, `SELECT * FROM tasks WHERE title='批量B'`)
    assert(a && a.deleted_at, '批量A 应被删除')
    assert(b && b.deleted_at, '批量B 应被删除')
  }
)

await runScenario(
  'settings-tags',
  [
    { js: `document.querySelector('.sb-foot .nav-item').click()`, wait: 600 },
    { js: setText('.tag-add input', '旅行', 'input'), wait: 300 },
    { js: clickText('.tag-add .mini-btn', '添加'), wait: 1100 },
    { js: `[...document.querySelectorAll('.tag-manage-row')].map((e) => e.textContent)`, wait: 100 },
    {
      js: `(() => { const row = [...document.querySelectorAll('.tag-manage-row')].find((r) => r.textContent.includes('旅行')); row?.querySelector('.mini-btn')?.click(); return row ? 'OK' : 'NO_ROW' })()`,
      wait: 600
    },
    { js: setText('.tag-manage-row .inline-input', '出差', 'input'), wait: 300 },
    { js: `document.querySelector('.tag-manage-row .inline-input')?.blur()`, wait: 1300 },
    { js: `(() => { window.confirm = () => true; return 'OK' })()`, wait: 50 },
    {
      js: `(() => { const row = [...document.querySelectorAll('.tag-manage-row')].find((r) => r.textContent.includes('出差')); row?.querySelector('.mini-btn.danger')?.click(); return row ? 'OK' : 'NO_ROW' })()`,
      wait: 1100
    }
  ],
  ({ db }) => {
    const tags = q(db, 'SELECT name FROM tags')
    assert(!tags.some((t) => t.name === '旅行'), '旅行应已改名')
    assert(!tags.some((t) => t.name === '出差'), '出差应已删除')
  }
)

await runScenario(
  'theme-dark',
  [
    { js: `document.querySelector('.sb-foot .nav-item').click()`, wait: 500 },
    { js: clickText('.settings .seg', '深色'), wait: 400 },
    { js: `document.documentElement.dataset.theme ?? ''`, wait: 100 }
  ],
  ({ out }) => {
    assert(out.results.at(-1) === 'dark', '主题应切换为 dark，实际 ' + out.results.at(-1))
  }
)

await runScenario(
  'settings-clear-completed',
  [
    { js: `document.querySelector('.task-row .check')?.click()`, wait: 800 },
    { js: `document.querySelector('.sb-foot .nav-item').click()`, wait: 500 },
    { js: `(() => { window.confirm = () => true; return 'OK' })()`, wait: 50 },
    { js: clickText('.set-row .mini-btn', '清空已完成'), wait: 1000 }
  ],
  ({ db }) => {
    const done = q(db, 'SELECT * FROM tasks WHERE status = 1')
    assert(done.length === 0, `清空后不应有已完成任务，实际 ${done.length}`)
  }
)

await runScenario(
  'autostart-read',
  [
    { js: `document.querySelector('.sb-foot .nav-item').click()`, wait: 700 },
    {
      js: `(() => {
        const row = [...document.querySelectorAll('.set-row')].find((r) => r.textContent.includes('开机自启'));
        return row?.querySelector('input[type=checkbox]')?.checked;
      })()`,
      wait: 100
    }
  ],
  ({ out }) => {
    assert(out.results.at(-1) === true, '应读取到已注册的开机自启，实际 ' + out.results.at(-1))
  },
  {
    setup: () => {
      execFileSync(
        'reg',
        ['add', RUN_KEY, '/v', 'LightTodo', '/t', 'REG_SZ', '/d', '"C:\\Windows\\notepad.exe"', '/f'],
        { windowsHide: true }
      )
    },
    teardown: () => {
      try {
        execFileSync('reg', ['delete', RUN_KEY, '/v', 'LightTodo', '/f'], { windowsHide: true })
      } catch {
        /* ignore */
      }
    }
  }
)

await runScenario(
  'calendar-overflow',
  [
    {
      js: `(async () => {
        const d = new Date();
        const s = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        await window.api.tasks.create({ title: '溢出任务A', scheduledDate: s });
        await window.api.tasks.create({ title: '溢出任务B', scheduledDate: s });
        return 'OK';
      })()`,
      wait: 500
    },
    { js: clickText('.nav-item', '日历'), wait: 800 },
    { js: `document.querySelector('.cal-cell.today')?.querySelectorAll('.cal-item').length`, wait: 100 },
    { js: `document.querySelector('.cal-cell.today .cal-more')?.textContent ?? ''`, wait: 100 },
    { js: `document.querySelector('.cal-cell.today')?.click()`, wait: 400 },
    { js: `document.querySelectorAll('.agenda-row').length`, wait: 100 },
    { js: `document.querySelector('.agenda-row .check')?.click()`, wait: 700 },
    { js: `document.querySelectorAll('.agenda-row').length`, wait: 100 }
  ],
  ({ out, db }) => {
    assert(out.results[2] >= 1 && out.results[2] <= 4, `月格显示条数异常，实际 ${out.results[2]}`)
    if (out.results[2] < 5) {
      const moreText = String(out.results[3])
      const remaining = Number((moreText.match(/\d+/) || ['0'])[0])
      assert(moreText.includes('还有') && out.results[2] + remaining === 5, `溢出提示条数不正确，实际 ${moreText}`)
    }
    assert(out.results[5] === 5, `弹层应显示全部 5 条，实际 ${out.results[5]}`)
    assert(out.results[7] === 4, `完成后弹层应剩 4 条，实际 ${out.results[7]}`)
    const done = one(db, `SELECT COUNT(*) AS c FROM tasks WHERE status = 1`)
    assert(done.c === 1, `应有 1 条已完成，实际 ${done.c}`)
  }
)

// 详情面板：点击无关区域自动关闭
await runScenario(
  'detail-click-outside',
  [
    {
      js: `(async () => {
        const mk = async (title) => (await window.api.tasks.create({ title })).id;
        const a = await mk('详情切换A');
        const b = await mk('详情切换B');
        await window.api.tasks.setStatus(a, true);
        await window.api.tasks.setStatus(b, true);
        return 'OK';
      })()`,
      wait: 700
    },
    { js: clickText('.nav-item', '已完成'), wait: 700 },
    { js: `[...document.querySelectorAll('.task-row')].find((r) => r.textContent.includes('详情切换B'))?.click()`, wait: 400 },
    { js: `document.querySelector('.detail-title')?.value ?? ''`, wait: 100 },
    { js: `[...document.querySelectorAll('.task-row')].find((r) => r.textContent.includes('详情切换A'))?.click()`, wait: 400 },
    { js: `document.querySelector('.detail-title')?.value ?? ''`, wait: 100 },
    { js: `document.querySelector('.section-head')?.click()`, wait: 300 },
    { js: `!!document.querySelector('.detail-title')`, wait: 100 }
  ],
  ({ out }) => {
    assert(String(out.results[3]).includes('详情切换B'), `应打开任务 B 详情，实际 ${out.results[3]}`)
    assert(String(out.results[5]).includes('详情切换A'), `点击另一任务应切换详情，实际 ${out.results[5]}`)
    assert(out.results[7] === false, '点击无关区域后详情面板应关闭')
  }
)

// 月视图：滚动到边界时加载相邻月份
await runScenario(
  'month-scroll',
  [
    { js: clickText('.nav-item', '日历'), wait: 700 },
    { js: `document.querySelectorAll('.calendar-modes .seg')[0].click()`, wait: 700 },
    { js: `document.querySelectorAll('[data-month-block]').length`, wait: 100 },
    { js: `(() => { const s = document.querySelector('.month-scroll'); s.scrollTop = s.scrollHeight; return s.scrollTop })()`, wait: 900 },
    { js: `document.querySelectorAll('[data-month-block]').length`, wait: 100 },
    { js: `(() => { const s = document.querySelector('.month-scroll'); s.scrollTop = 0; return s.scrollTop })()`, wait: 900 },
    { js: `document.querySelectorAll('[data-month-block]').length`, wait: 100 },
    { js: `document.querySelector('.month-scroll')?.scrollTop ?? -1`, wait: 100 }
  ],
  ({ out }) => {
    const initial = Number(out.results[2])
    const afterBottom = Number(out.results[4])
    const afterTop = Number(out.results[6])
    assert(initial >= 3, `月视图初始应至少加载 3 个月，实际 ${initial}`)
    assert(afterBottom > initial, `滚动到底部应追加月份，实际 ${initial} → ${afterBottom}`)
    assert(afterTop > afterBottom, `滚动到顶部应补充月份，实际 ${afterBottom} → ${afterTop}`)
    assert(Number(out.results[7]) > 0, '补充上一个月后滚动位置不应停在 0')
  }
)

// 也许：新增任务只进入也许，不进入今天
await runScenario(
  'maybe-add',
  [
    { js: clickText('.nav-item', '也许'), wait: 700 },
    { js: `({ filters: [...document.querySelectorAll('.filter-chip')].map((e) => e.textContent.trim()), hint: document.querySelector('.view-hint')?.textContent })`, wait: 100 },
    { js: `document.querySelector('.main-head .ghost-btn:last-child').click()`, wait: 300 },
    { js: setText('.qa-input', '也许回归任务'), wait: 200 },
    { js: `document.querySelector('.qa-submit').click()`, wait: 800 },
    { js: rows, wait: 100 },
    { js: clickText('.nav-item', '今天'), wait: 700 },
    { js: rows, wait: 100 }
  ],
  ({ out, db }) => {
    const filters = out.results[1].filters
    assert(JSON.stringify(filters) === JSON.stringify(['全部', '高优先级']), `也许筛选不应包含日期筛选: ${filters}`)
    assert(String(out.results[1].hint).includes('不会进入'), '也许视图应说明不会进入今天')
    assert(out.results[5].includes('也许回归任务'), '也许视图应显示新增任务')
    assert(!out.results[7].includes('也许回归任务'), '也许任务不应出现在今天视图')
    const t = one(db, `SELECT * FROM tasks WHERE title='也许回归任务'`)
    assert(t && t.someday === 1 && t.scheduled_date === null, '也许任务应标记 someday 且无日期')
  }
)

// 最近 7 天：无日期新增默认明天的任务
await runScenario(
  'upcoming-add',
  [
    { js: clickText('.nav-item', '最近 7 天'), wait: 700 },
    { js: `[...document.querySelectorAll('.filter-chip')].map((e) => e.textContent.trim())`, wait: 100 },
    { js: `document.querySelector('.main-head .ghost-btn:last-child').click()`, wait: 300 },
    { js: setText('.qa-input', '未来回归任务'), wait: 200 },
    { js: `document.querySelector('.qa-submit').click()`, wait: 800 },
    { js: rows, wait: 100 }
  ],
  ({ out, db }) => {
    assert(JSON.stringify(out.results[1]) === JSON.stringify(['全部', '高优先级']), '最近 7 天筛选应只保留全部和高优先级')
    assert(out.results[5].includes('未来回归任务'), '最近 7 天视图应显示新增任务')
    const t = one(db, `SELECT * FROM tasks WHERE title='未来回归任务'`)
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const expected = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
    assert(t && t.scheduled_date === expected, `最近 7 天新增任务应默认明天，实际 ${t?.scheduled_date}`)
  }
)

// Ctrl+F 打开搜索
await runScenario(
  'shortcut-search',
  [
    { js: `(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true })); return 'OK' })()`, wait: 300 },
    { js: `({ search: !!document.querySelector('.search-panel'), label: document.querySelector('.titlebar-search kbd')?.textContent })`, wait: 100 }
  ],
  ({ out }) => {
    assert(out.results[1].search === true, 'Ctrl+F 应打开搜索面板')
    assert(out.results[1].label === 'Ctrl F', '搜索入口应显示 Ctrl F')
  }
)

// 已完成 / 回收站批量删除
await runScenario(
  'batch-completed-trash',
  [
    {
      js: `(async () => {
        const mk = async (title) => (await window.api.tasks.create({ title })).id;
        const a = await mk('批量已完成A');
        const b = await mk('批量已完成B');
        const c = await mk('回收站批量C');
        const d = await mk('回收站批量D');
        await window.api.tasks.setStatus(a, true);
        await window.api.tasks.setStatus(b, true);
        await window.api.tasks.remove(c);
        await window.api.tasks.remove(d);
        return 'OK';
      })()`,
      wait: 700
    },
    { js: clickText('.nav-item', '已完成'), wait: 700 },
    { js: clickText('.head-actions .ghost-btn', '多选'), wait: 300 },
    { js: `document.querySelector('.bulk-bar .mini-btn')?.click()`, wait: 300 },
    { js: `[...document.querySelectorAll('.bulk-bar .mini-btn')].find((b) => b.textContent.trim() === '删除')?.click()`, wait: 900 },
    { js: `document.querySelectorAll('.task-row').length`, wait: 100 },
    { js: clickText('.nav-item', '回收站'), wait: 700 },
    { js: clickText('.head-actions .ghost-btn', '多选'), wait: 300 },
    { js: `document.querySelector('.bulk-bar .mini-btn')?.click()`, wait: 300 },
    { js: `(() => { window.confirm = () => true; return 'OK' })()`, wait: 50 },
    { js: `[...document.querySelectorAll('.bulk-bar .mini-btn')].find((b) => b.textContent.trim() === '彻底删除')?.click()`, wait: 900 },
    { js: `document.querySelectorAll('.trash-row').length`, wait: 100 }
  ],
  ({ out, db }) => {
    assert(out.results[5] === 0, `已完成批量删除后应为空，实际 ${out.results[5]}`)
    assert(out.results[11] === 0, `回收站批量彻底删除后应为空，实际 ${out.results[11]}`)
    const rows = q(db, `SELECT * FROM tasks WHERE title LIKE '批量已完成%' OR title LIKE '回收站批量%'`)
    assert(rows.length === 0, `批量删除的任务应已彻底移除，实际 ${rows.length} 条`)
  }
)


// 持久化：两次启动同一数据目录
if (!only || only === 'persistence') {
  const dir = join(E2E_DIR, 'persistence')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const env = { ...process.env, LIGHTTODO_DATA_DIR: dir }
  delete env.ELECTRON_RUN_AS_NODE

  const launch = async (steps) => {
    const specPath = join(dir, `spec-${Date.now()}.json`)
    writeFileSync(specPath, JSON.stringify({ steps }))
    const child = spawn(EXE, ['--no-sandbox', '--disable-gpu', '.', `--e2e=${specPath}`], {
      cwd: ROOT,
      env,
      stdio: 'ignore'
    })
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        child.kill()
        reject(new Error('timeout'))
      }, 90000)
      child.on('exit', () => {
        clearTimeout(t)
        resolve()
      })
    })
    return JSON.parse(readFileSync(specPath.replace('.json', '.out.json'), 'utf8'))
  }

  const started = Date.now()
  try {
    await launch([
      { js: `document.querySelector('.new-task').click()`, wait: 300 },
      { js: setText('.qa-input', '持久化任务'), wait: 200 },
      { js: `document.querySelector('.qa-submit').click()`, wait: 600 }
    ])
    const second = await launch([{ js: rows, wait: 300 }])
    const titles = second.results[0]
    assert(titles.includes('持久化任务'), '重启后任务丢失')
    results.push({ name: 'persistence', ok: true, ms: Date.now() - started })
    console.log(`✅ PASS  persistence  (${Date.now() - started}ms)`)
  } catch (e) {
    failed++
    results.push({ name: 'persistence', ok: false, ms: Date.now() - started, error: e.message })
    console.log(`❌ FAIL  persistence\n        ${e.message}`)
  }
}

// ── 汇总 ────────────────────────────────────────────────
console.log('\n================ 汇总 ================')
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  ${r.ms}ms`)
console.log(`总计 ${results.length}，失败 ${failed}`)
process.exit(failed ? 1 : 0)
