#!/usr/bin/env node
/**
 * 虚拟滚动定向验收（不是全量 E2E）：
 * 1. 用正式 DB 模块生成 600 条任务（超过 150 条阈值）；
 * 2. 启动真实 Electron，切到「全部」；
 * 3. 断言 DOM 只渲染窗口内少量 .task-row、滚动到底仍保持少量节点；
 * 4. 点击「加载更多」后总数增长，仍保持虚拟化。
 *
 * 运行：node scripts/e2e-virtual.mjs
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const ROOT = process.cwd()
const EXE = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const DIR = join(ROOT, '.tmp', 'e2e', 'virtual')
const TASKS = 600

function assert(cond, msg) {
  if (!cond) throw new Error('断言失败: ' + msg)
}

rmSync(DIR, { recursive: true, force: true })
mkdirSync(DIR, { recursive: true })

// Seed through src/main/db.ts so this test always follows the real schema.
// stdio: 'ignore' avoids the DSH Windows sandbox restriction on piped stdio.
const seed = spawnSync(
  process.execPath,
  ['--experimental-strip-types', 'scripts/seed-bench-10k.ts', '--dir', relative(ROOT, DIR), '--count', String(TASKS)],
  { cwd: ROOT, stdio: 'ignore', timeout: 120000 }
)
if (seed.status !== 0) {
  throw new Error(`seed-bench-10k failed (status=${seed.status}, error=${seed.error ?? 'none'})`)
}

const clickText = (selector, text) => `(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent?.includes(${JSON.stringify(text)}));
  if (!el) return 'NOT_FOUND';
  el.click();
  return 'CLICKED';
})()`

const snapshot = `(() => {
  const scroller = document.querySelector('.task-scroll');
  const rows = document.querySelectorAll('.task-row');
  return {
    virtualized: scroller?.dataset.virtualized,
    total: Number(scroller?.dataset.totalRows ?? 0),
    rows: rows.length,
    count: document.querySelector('.main-count')?.textContent ?? '',
    scrollTop: scroller?.scrollTop ?? 0,
    scrollHeight: scroller?.scrollHeight ?? 0,
    lastTitle: rows.length ? rows[rows.length - 1]?.querySelector('.task-title')?.textContent ?? '' : ''
  };
})()`

const specPath = join(DIR, 'virtual-spec.json')
writeFileSync(
  specPath,
  JSON.stringify({
    steps: [
      { js: clickText('.nav-item', '全部'), wait: 900 },
      { js: snapshot, wait: 300 },
      { js: `(() => { const e = document.querySelector('.task-scroll'); if (!e) return 'NO_SCROLL'; e.scrollTop = e.scrollHeight; return e.scrollTop; })()`, wait: 500 },
      { js: snapshot, wait: 100 },
      { js: `(() => { document.querySelector('.load-more')?.click(); return 'CLICKED'; })()`, wait: 1200 },
      { js: snapshot, wait: 200 }
    ]
  })
)

const env = { ...process.env, LIGHTTODO_DATA_DIR: DIR }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(EXE, ['--no-sandbox', '--disable-gpu', '.', `--e2e=${specPath}`], {
  cwd: ROOT,
  env,
  stdio: 'ignore'
})

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Electron 超时'))
    }, 120000)
    child.on('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    child.on('error', reject)
  })

  const outPath = specPath.replace(/\.json$/, '.out.json')
  if (!existsSync(outPath)) throw new Error('没有生成 e2e 结果文件')
  const out = JSON.parse(readFileSync(outPath, 'utf8'))
  if (!out.ok) throw new Error(out.error ?? '应用内脚本失败')
  const first = out.results[1]
  const scrolled = out.results[3]
  const afterMore = out.results[5]

  const db = new DatabaseSync(join(DIR, 'lighttodo.db'))
  const active = db.prepare('SELECT COUNT(*) AS c FROM tasks WHERE deleted_at IS NULL AND status = 0 AND parent_id IS NULL').get().c
  db.close()

  console.log('first', first)
  console.log('scrolled', scrolled)
  console.log('afterMore', afterMore)
  console.log('db active', active)

  assert(first.virtualized === 'true', '600 条时应进入虚拟模式')
  assert(first.total === 500, `首屏应加载 500 条，实际 ${first.total}`)
  assert(first.rows >= 5 && first.rows <= 80, `首屏 DOM 行数应远小于 500，实际 ${first.rows}`)
  assert(scrolled.rows >= 5 && scrolled.rows <= 80, `滚动到底后 DOM 行数仍应很小，实际 ${scrolled.rows}`)
  assert(scrolled.lastTitle.includes('任务'), '滚动到底应能看到最后一条任务')
  assert(afterMore.total === active, `加载更多后应显示全部 ${active} 条，实际 ${afterMore.total}`)
  assert(afterMore.rows >= 5 && afterMore.rows <= 80, `加载更多后仍应虚拟化，实际 DOM ${afterMore.rows}`)
  console.log('OK 虚拟滚动定向验收通过')
} finally {
  try {
    child.kill()
  } catch {
    /* ignore */
  }
}
