#!/usr/bin/env node
/**
 * 用 CDP 调试端口启动 LightTodo，供 Playwright MCP（playwright-app 实例）接管窗口。
 *
 * 用法：
 *   node scripts/app-cdp.mjs                 # 启动（默认端口 9222，数据目录 .e2e-playwright）
 *   node scripts/app-cdp.mjs --fresh         # 先杀旧实例并清空数据目录
 *   node scripts/app-cdp.mjs --packaged      # 启动 release/win-unpacked/LightTodo.exe
 *   node scripts/app-cdp.mjs --exe release/0.2.10/LightTodo-0.2.10-x64.exe
 *   node scripts/app-cdp.mjs --kill          # 结束由本脚本启动的实例
 *   node scripts/app-cdp.mjs --port 9333 --data .e2e-cdp2 --timeout 60000
 *
 * 关键点（DSH 环境）：
 *   - 必须清掉 ELECTRON_RUN_AS_NODE，否则 Electron 会退化成 Node；
 *   - 需要 --no-sandbox --disable-gpu，且 userData 必须落在工作区内；
 *   - 应用有单实例锁：测试前先关掉用户自己打开的 LightTodo。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = process.cwd()
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const port = Number(opt('port', '9222'))
const dataDir = resolve(ROOT, opt('data', '.e2e-playwright'))
const packaged = flag('packaged') || argv.includes('--exe')
const pidFile = join(dataDir, 'app.pid')

function killPrevious() {
  if (!existsSync(pidFile)) return false
  const pid = Number(readFileSync(pidFile, 'utf8').trim())
  if (!pid) return false
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
  rmSync(pidFile, { force: true })
  return true
}

if (flag('kill')) {
  const killed = killPrevious()
  console.log(killed ? '已结束 LightTodo 测试实例' : '没有记录到测试实例 PID')
  process.exit(0)
}

if (flag('fresh')) {
  killPrevious()
  rmSync(dataDir, { recursive: true, force: true })
}

mkdirSync(dataDir, { recursive: true })

const exe = argv.includes('--exe') ? resolve(ROOT, opt('exe', '')) : packaged
  ? join(ROOT, 'release', 'win-unpacked', 'LightTodo.exe')
  : join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
if (!existsSync(exe)) {
  console.error(`找不到可执行文件：${exe}`)
  process.exit(1)
}

const args = ['--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`]
if (!packaged) args.push('.')

const env = { ...process.env, LIGHTTODO_DATA_DIR: dataDir }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(exe, args, { cwd: ROOT, env, detached: true, stdio: 'ignore' })
child.unref()
writeFileSync(pidFile, String(child.pid))

const endpoint = `http://127.0.0.1:${port}`
const deadline = Date.now() + Number(opt('timeout', '60000'))
let version = null
while (Date.now() < deadline) {
  try {
    const r = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1500) })
    if (r.ok) {
      version = await r.json()
      break
    }
  } catch {
    /* 还没起来 */
  }
  await new Promise((r) => setTimeout(r, 400))
}

if (!version) {
  console.error(`CDP 端口 ${port} 在超时内没有就绪（应用可能已退出或已有实例占用单实例锁）`)
  process.exit(1)
}

const pages = await fetch(`${endpoint}/json/list`).then((r) => r.json())
const windows = pages.filter((p) => p.type === 'page')

console.log(`LightTodo 已启动  pid=${child.pid}`)
console.log(`CDP: ${endpoint}  ${version.Browser}`)
for (const w of windows) console.log(`窗口: ${w.title}  ${w.url}`)
console.log(`数据目录: ${dataDir}`)
console.log('下一步：用 Playwright MCP 的 playwright-app 实例（mcp__playwright_app__browser_*）操作该窗口')
