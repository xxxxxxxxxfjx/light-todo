/**
 * 压力/性能链路：500 条任务下启动、切视图、搜索、日历渲染。
 * 运行：node --experimental-strip-types scripts/e2e-stress.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  initDb,
  closeDb,
  createTask,
  createList,
  setTaskStatus,
  listTasks,
  searchTasks
} from '../src/main/db.ts'

const ROOT = process.cwd()
const EXE = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const DIR = join(ROOT, '.e2e-stress')

rmSync(DIR, { recursive: true, force: true })
mkdirSync(DIR, { recursive: true })

const dayStr = (offset) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

initDb(DIR)
const list = createList({ name: '压测清单' })
const t0 = performance.now()
for (let i = 0; i < 500; i++) {
  createTask({
    title: `压测任务 ${i}`,
    listId: i % 2 === 0 ? list.id : null,
    priority: i % 4,
    scheduledDate: i % 3 === 0 ? dayStr(i % 20) : null,
    tagNames: i % 3 === 0 ? ['压测'] : []
  })
}
const seedMs = performance.now() - t0

const all = listTasks({ view: 'all', limit: 1000 })
const q0 = performance.now()
listTasks({ view: 'all', limit: 1000 })
const queryMs = performance.now() - q0
const s0 = performance.now()
searchTasks('压测任务 42')
const searchMs = performance.now() - s0

// 完成 50 条，制造已完成数据
let done = 0
for (const t of all) {
  if (done >= 50) break
  if (t.status === 0) {
    setTaskStatus(t.id, true)
    done++
  }
}
closeDb()

const steps = [
  {
    js: `new Promise((resolve) => {
      const t0 = performance.now();
      const iv = setInterval(() => {
        const n = document.querySelectorAll('.task-row').length;
        if (n > 0) { clearInterval(iv); resolve({ ms: Math.round(performance.now() - t0), rows: n }); }
      }, 20);
      setTimeout(() => { clearInterval(iv); resolve({ ms: -1, rows: 0 }); }, 10000);
    })`,
    wait: 100
  },
  {
    js: `new Promise((resolve) => {
      const t0 = performance.now();
      [...document.querySelectorAll('.nav-item')].find((e) => e.textContent.trim().startsWith('全部'))?.click();
      const iv = setInterval(() => {
        const n = document.querySelectorAll('.task-row').length;
        if (n > 0) { clearInterval(iv); resolve({ ms: Math.round(performance.now() - t0), rows: n }); }
      }, 20);
      setTimeout(() => { clearInterval(iv); resolve({ ms: -1, rows: 0 }); }, 8000);
    })`,
    wait: 100
  },
  {
    js: `new Promise((resolve) => {
      const t0 = performance.now();
      document.querySelector('.titlebar-search')?.click();
      setTimeout(() => {
        const el = document.querySelector('.search-input-row input');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, '压测任务 42');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        const iv = setInterval(() => {
          const n = document.querySelectorAll('.search-row').length;
          if (n > 0) { clearInterval(iv); resolve({ ms: Math.round(performance.now() - t0), rows: n }); }
        }, 20);
        setTimeout(() => { clearInterval(iv); resolve({ ms: -1, rows: 0 }); }, 8000);
      }, 300);
    })`,
    wait: 100
  },
  {
    js: `new Promise((resolve) => {
      const t0 = performance.now();
      [...document.querySelectorAll('.nav-item')].find((e) => e.textContent.includes('日历'))?.click();
      const iv = setInterval(() => {
        const n = document.querySelectorAll('.cal-cell').length;
        if (n >= 42) { clearInterval(iv); resolve({ ms: Math.round(performance.now() - t0), cells: n, items: document.querySelectorAll('.cal-item').length }); }
      }, 20);
      setTimeout(() => { clearInterval(iv); resolve({ ms: -1, cells: 0 }); }, 8000);
    })`,
    wait: 100
  }
]

const specPath = join(DIR, 'spec.json')
writeFileSync(specPath, JSON.stringify({ steps }))

const env = { ...process.env, LIGHTTODO_DATA_DIR: DIR }
delete env.ELECTRON_RUN_AS_NODE
const tBoot = performance.now()
const child = spawn(EXE, ['--no-sandbox', '--disable-gpu', '.', `--e2e=${specPath}`], {
  cwd: ROOT,
  env,
  stdio: 'ignore'
})
await new Promise((resolve, reject) => {
  const t = setTimeout(() => {
    child.kill()
    reject(new Error('timeout'))
  }, 60000)
  child.on('exit', () => {
    clearTimeout(t)
    resolve()
  })
})
const bootMs = performance.now() - tBoot
const out = JSON.parse(readFileSync(specPath.replace('.json', '.out.json'), 'utf8'))
if (!out.ok) throw new Error(out.error)

const db = new DatabaseSync(join(DIR, 'lighttodo.db'))
const counts = db.prepare('SELECT status, COUNT(*) c FROM tasks GROUP BY status').all()
db.close()

const [firstRender, allView, search, calendar] = out.results
let failed = 0
function check(name, cond, detail) {
  if (cond) console.log('PASS', name, detail ?? '')
  else {
    failed++
    console.error('FAIL', name, detail ?? '')
  }
}

check('STRESS-01 种子 500 条', counts.reduce((s, r) => s + r.c, 0) === 503, JSON.stringify(counts))
check('STRESS-02 数据库写入 < 3s', seedMs < 3000, `${Math.round(seedMs)}ms`)
check('STRESS-03 查询 500 条 < 300ms', queryMs < 300, `${Math.round(queryMs)}ms`)
check('STRESS-04 搜索 < 300ms', searchMs < 300, `${Math.round(searchMs)}ms`)
check('STRESS-05 首屏渲染 < 10s（本机无 GPU）', firstRender.rows > 0, JSON.stringify(firstRender))
check('STRESS-06 切换全部 < 3s', allView.ms > 0 && allView.ms < 3000, JSON.stringify(allView))
check('STRESS-07 全部视图渲染 ≥ 400 行', allView.rows >= 400, JSON.stringify(allView))
check('STRESS-08 搜索响应 < 3s', search.ms > 0 && search.ms < 3000, JSON.stringify(search))
check('STRESS-09 日历渲染 < 3s', calendar.ms > 0 && calendar.ms < 3000, JSON.stringify(calendar))
check('STRESS-10 启动总耗时 < 20s', bootMs < 20000, `${Math.round(bootMs)}ms`)

console.log(failed ? `\n${failed} 项失败` : '\n压力测试全部通过')
process.exit(failed ? 1 : 0)
