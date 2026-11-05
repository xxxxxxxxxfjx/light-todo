#!/usr/bin/env node
/**
 * Reproducible LightTodo performance benchmark.
 *
 * DB stage:
 *   getSidebar, today, all(1000), all(10000), upcoming, Chinese/English search.
 *   One warm-up, then 5 measured runs; P50/P95 use linear interpolation.
 *
 * App stage:
 *   Launch the existing Electron build three times with isolated data, read
 *   COLD_START_MS from userdata/startup.log, load the "all" view through
 *   repeated .load-more clicks, then measure a 2-second requestAnimationFrame
 *   top-to-bottom scroll.
 *
 * Run from the repository root:
 *   node --experimental-strip-types scripts/bench-perf.ts
 *   node --experimental-strip-types scripts/bench-perf.ts --dir .tmp/perf/bench --runs 5 --app-runs 3
 *
 * Only Node built-ins and existing project dependencies are used.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { arch, cpus, hostname, release, totalmem } from 'node:os'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'
import {
  closeDb,
  getSidebar,
  initDb,
  listTasks,
  searchTasks
} from '../src/main/db.ts'

const ROOT = resolve(process.cwd())
const STARTED_AT = new Date()

function fail(message: string): never {
  console.error(`bench-perf: ${message}`)
  process.exit(1)
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  if (index < 0) return fallback
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) fail(`--${name} requires a value`)
  return value
}

function numberArg(name: string, fallback: number, min: number, max: number): number {
  const raw = argValue(name, String(fallback))
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`--${name} must be an integer between ${min} and ${max} (received ${raw})`)
  }
  return value
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN
  if (sorted.length === 1) return sorted[0]
  const rank = (sorted.length - 1) * p
  const low = Math.floor(rank)
  const high = Math.ceil(rank)
  if (low === high) return sorted[low]
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low)
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function safePathInsideRepo(relativeOrAbsolute: string, label: string): string {
  const resolved = resolve(ROOT, relativeOrAbsolute)
  const rel = relative(ROOT, resolved)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    fail(`${label} must be inside the repository workspace`)
  }
  return resolved
}

if (hasFlag('help') || hasFlag('h')) {
  console.log(`Usage: node --experimental-strip-types scripts/bench-perf.ts [options]

  --dir <path>          benchmark data directory (default: .tmp/perf/bench)
  --runs <n>            DB measured runs after one warm-up (default: 5)
  --app-runs <n>        app launches for cold-start samples (default: 3)
  --target-rows <n>     load-more ceiling, capped by active tasks (default: 10000)
  --fps-duration <ms>   scroll measurement window (default: 2000)
  --port <n>            fixed CDP port; default picks a free loopback port
  --electron <path>     electron.exe (default: node_modules/electron/dist/electron.exe)
  --json <path>         JSON output path; default .tmp/perf/results/<timestamp>.json
  --md <path>           Markdown output path; default beside JSON
  --skip-db             skip database benchmarks
  --skip-app            skip Electron/CDP benchmarks
  --help                show this help`)
  process.exit(0)
}

const DATA_DIR = safePathInsideRepo(argValue('dir', '.tmp/perf/bench'), '--dir')
const RUNS = numberArg('runs', 5, 1, 100)
const APP_RUNS = numberArg('app-runs', 3, 1, 10)
const TARGET_ROWS = numberArg('target-rows', 10000, 1, 100000)
const FPS_DURATION_MS = numberArg('fps-duration', 2000, 250, 15000)
const APP_TIMEOUT_MS = numberArg('timeout', 90000, 5000, 600000)
const FIXED_PORT = numberArg('port', 0, 0, 65535)
const SKIP_DB = hasFlag('skip-db')
const SKIP_APP = hasFlag('skip-app')
const ELECTRON_EXE = resolve(ROOT, argValue('electron', join('node_modules', 'electron', 'dist', 'electron.exe')))

const stamp = STARTED_AT.toISOString().replace(/[:.]/g, '-')
const RESULT_DIR = join(ROOT, '.tmp', 'perf', 'results')
const jsonArg = argValue('json', '')
const mdArg = argValue('md', '')
const JSON_PATH = jsonArg
  ? resolve(ROOT, jsonArg)
  : join(RESULT_DIR, `${stamp}.json`)
const MD_PATH = mdArg
  ? resolve(ROOT, mdArg)
  : jsonArg
    ? JSON_PATH.replace(/\.json$/i, '') + '.md'
    : join(RESULT_DIR, `${stamp}.md`)

if (!existsSync(join(DATA_DIR, 'lighttodo.db'))) {
  fail(
    `database not found at ${join(DATA_DIR, 'lighttodo.db')}; run ` +
      'node --experimental-strip-types scripts/seed-bench-10k.ts --dir ' +
      argValue('dir', '.tmp/perf/bench')
  )
}

function electronVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')
    ) as { version?: string }
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

function appVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      version?: string
    }
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

interface DatasetMeta {
  total: number
  activeAll: number
  completed: number
  trash: number
  lists: number
  tags: number
  databaseBytes: number
}

function readDatasetMeta(): DatasetMeta {
  const db = new DatabaseSync(join(DATA_DIR, 'lighttodo.db'), { readOnly: true })
  try {
    const row = db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN deleted_at IS NULL AND status = 0 AND parent_id IS NULL THEN 1 ELSE 0 END) AS active_all,
           SUM(CASE WHEN deleted_at IS NULL AND status = 1 AND parent_id IS NULL THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN deleted_at IS NOT NULL AND parent_id IS NULL THEN 1 ELSE 0 END) AS trash
         FROM tasks`
      )
      .get() as Record<string, number | null>
    const lists = db.prepare('SELECT COUNT(*) AS c FROM lists').get() as { c: number }
    const tags = db.prepare('SELECT COUNT(*) AS c FROM tags').get() as { c: number }
    const pageCount = db.prepare('PRAGMA page_count').get() as { page_count: number }
    const pageSize = db.prepare('PRAGMA page_size').get() as { page_size: number }
    return {
      total: Number(row.total ?? 0),
      activeAll: Number(row.active_all ?? 0),
      completed: Number(row.completed ?? 0),
      trash: Number(row.trash ?? 0),
      lists: lists.c,
      tags: tags.c,
      databaseBytes: pageCount.page_count * pageSize.page_size
    }
  } finally {
    db.close()
  }
}

const dataset = readDatasetMeta()
if (dataset.total === 0) fail('benchmark database contains no tasks')

interface QueryDefinition {
  id: string
  label: string
  api: string
  run: () => unknown
}

interface QueryResult {
  id: string
  label: string
  api: string
  rows: number | null
  samplesMs: number[]
  p50Ms: number
  p95Ms: number
  minMs: number
  maxMs: number
}

const QUERIES: QueryDefinition[] = [
  {
    id: 'sidebar',
    label: 'getSidebar',
    api: 'getSidebar()',
    run: () => getSidebar()
  },
  {
    id: 'today',
    label: 'listTasks(today)',
    api: "listTasks({ view: 'today' })",
    run: () => listTasks({ view: 'today' })
  },
  {
    id: 'all-1000',
    label: 'listTasks(all, 1000)',
    api: "listTasks({ view: 'all', limit: 1000 })",
    run: () => listTasks({ view: 'all', limit: 1000 })
  },
  {
    id: 'all-10000',
    label: 'listTasks(all, 10000)',
    api: "listTasks({ view: 'all', limit: 10000 })",
    run: () => listTasks({ view: 'all', limit: 10000 })
  },
  {
    id: 'upcoming',
    label: 'listTasks(upcoming)',
    api: "listTasks({ view: 'upcoming' })",
    run: () => listTasks({ view: 'upcoming' })
  },
  {
    id: 'search-cn',
    label: 'searchTasks(会议)',
    api: "searchTasks('会议')",
    run: () => searchTasks('会议')
  },
  {
    id: 'search-en',
    label: 'searchTasks(meeting)',
    api: "searchTasks('meeting')",
    run: () => searchTasks('meeting')
  }
]

interface DbStageResult {
  ok: boolean
  runs: number
  warmupRuns: number
  queries: QueryResult[]
  error?: string
}

function runDbStage(): DbStageResult {
  const result: DbStageResult = { ok: false, runs: RUNS, warmupRuns: 1, queries: [] }
  try {
    initDb(DATA_DIR)
    for (const query of QUERIES) {
      query.run() // warm-up, not measured
      const samples: number[] = []
      let rows: number | null = null
      for (let run = 0; run < RUNS; run += 1) {
        const before = performance.now()
        const value = query.run()
        const elapsed = performance.now() - before
        samples.push(round(elapsed))
        rows = Array.isArray(value) ? value.length : null
      }
      const sorted = [...samples].sort((a, b) => a - b)
      result.queries.push({
        id: query.id,
        label: query.label,
        api: query.api,
        rows,
        samplesMs: samples,
        p50Ms: round(percentile(sorted, 0.5)),
        p95Ms: round(percentile(sorted, 0.95)),
        minMs: round(sorted[0]),
        maxMs: round(sorted[sorted.length - 1])
      })
    }
    result.ok = true
  } catch (error) {
    result.error = error instanceof Error ? error.stack ?? error.message : String(error)
  } finally {
    closeDb()
  }
  return result
}

interface CdpClient {
  send: (method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<any>
  close: () => void
}

async function connectCdp(url: string, timeoutMs = 10000): Promise<CdpClient> {
  if (typeof WebSocket !== 'function') {
    throw new Error('global WebSocket is unavailable (Node 22+ is required)')
  }
  const ws = new WebSocket(url)
  const pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >()
  let nextId = 1
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      rejectPromise(new Error(`timed out connecting to CDP ${url}`))
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    }, timeoutMs)
    ws.addEventListener(
      'open',
      () => {
        clearTimeout(timer)
        resolvePromise()
      },
      { once: true }
    )
    ws.addEventListener(
      'error',
      () => {
        clearTimeout(timer)
        rejectPromise(new Error(`WebSocket error connecting to ${url}`))
      },
      { once: true }
    )
  })

  ws.addEventListener('message', (event: MessageEvent) => {
    const raw =
      typeof event.data === 'string'
        ? event.data
        : event.data instanceof ArrayBuffer
          ? Buffer.from(event.data).toString('utf8')
          : Buffer.from(event.data as ArrayBufferView).toString('utf8')
    let message: any
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }
    if (typeof message.id !== 'number') return
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    clearTimeout(entry.timer)
    if (message.error) entry.reject(new Error(`${message.error.message} (${message.error.code})`))
    else entry.resolve(message.result)
  })

  ws.addEventListener('close', () => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error('CDP socket closed'))
    }
    pending.clear()
  })

  return {
    send(method: string, params: Record<string, unknown> = {}, timeout = 30000): Promise<any> {
      return new Promise((resolvePromise, rejectPromise) => {
        const id = nextId++
        const timer = setTimeout(() => {
          pending.delete(id)
          rejectPromise(new Error(`CDP ${method} timed out after ${timeout}ms`))
        }, timeout)
        pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer })
        try {
          ws.send(JSON.stringify({ id, method, params }))
        } catch (error) {
          clearTimeout(timer)
          pending.delete(id)
          rejectPromise(error instanceof Error ? error : new Error(String(error)))
        }
      })
    },
    close(): void {
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    }
  }
}

async function fetchJson(url: string, timeoutMs = 2000): Promise<any> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  return response.json()
}

interface PageTarget {
  id: string
  type: string
  title: string
  url: string
  webSocketDebuggerUrl: string
}

async function waitForPageTarget(port: number, timeoutMs: number): Promise<PageTarget> {
  const deadline = Date.now() + timeoutMs
  let lastError = 'no page target'
  while (Date.now() < deadline) {
    try {
      const pages = (await fetchJson(`http://127.0.0.1:${port}/json/list`)) as PageTarget[]
      const candidates = pages.filter(
        (page) =>
          page.type === 'page' &&
          typeof page.webSocketDebuggerUrl === 'string' &&
          !page.url.startsWith('devtools://')
      )
      const preferred =
        candidates.find((page) => page.url.includes('index.html')) ??
        candidates.find((page) => page.title.includes('轻单')) ??
        candidates[0]
      if (preferred) return preferred
      lastError = 'CDP is up but no application page target exists yet'
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await sleep(200)
  }
  throw new Error(`timed out waiting for page target: ${lastError}`)
}

async function evaluate(
  cdp: CdpClient,
  expression: string,
  awaitPromise = true,
  timeoutMs = 30000
): Promise<any> {
  const response = await cdp.send(
    'Runtime.evaluate',
    {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true
    },
    timeoutMs
  )
  if (response?.exceptionDetails) {
    const description =
      response.exceptionDetails.exception?.description ??
      response.exceptionDetails.text ??
      'JavaScript evaluation failed'
    throw new Error(description)
  }
  return response?.result?.value
}

async function waitUntil(
  check: () => Promise<boolean>,
  timeoutMs: number,
  label: string,
  intervalMs = 100
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await sleep(intervalMs)
  }
  throw new Error(`timed out waiting for ${label}`)
}

interface LaunchHandle {
  child: ChildProcess
  pid: number
  port: number
  launchedAt: number
  startupLogPath: string
  startupLogOffset: number
  coldStartPromise: Promise<number>
  startupLog: () => string
}

function killProcessTree(pid: number | null | undefined): void {
  if (!pid) return
  try {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 15000
    })
  } catch {
    /* best effort; caller also verifies the port */
  }
}

let activePid: number | null = null
process.on('exit', () => killProcessTree(activePid))
process.on('SIGINT', () => {
  killProcessTree(activePid)
  process.exit(130)
})
process.on('SIGTERM', () => {
  killProcessTree(activePid)
  process.exit(143)
})

async function choosePort(): Promise<number> {
  if (FIXED_PORT > 0) return FIXED_PORT
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer()
    server.unref()
    server.once('error', rejectPromise)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => {
        if (port > 0) resolvePromise(port)
        else rejectPromise(new Error('could not allocate a CDP port'))
      })
    })
  })
}

async function launchElectron(
  port: number,
  timeoutMs: number,
  _runIndex: number
): Promise<LaunchHandle> {
  if (!existsSync(ELECTRON_EXE)) fail(`electron executable not found: ${ELECTRON_EXE}`)
  const args = [
    '--no-sandbox',
    '--disable-gpu',
    '--enable-precise-memory-info',
    `--remote-debugging-port=${port}`,
    '.'
  ]
  const env = { ...process.env, LIGHTTODO_DATA_DIR: DATA_DIR }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL

  const userDataDir = join(DATA_DIR, 'userdata')
  mkdirSync(userDataDir, { recursive: true })
  const startupLogPath = join(userDataDir, 'startup.log')
  const startupLogOffset = existsSync(startupLogPath) ? statSync(startupLogPath).size : 0
  const readStartupLog = (): string => {
    try {
      const bytes = readFileSync(startupLogPath)
      return bytes.subarray(startupLogOffset).toString('utf8')
    } catch {
      return ''
    }
  }

  const launchedAt = Date.now()
  // DSH Windows sandbox: piped stdio makes Electron/Chromium fail while
  // creating its Mojo platform channel. stdio:'ignore' + detached is the
  // same launch shape as scripts/app-cdp.mjs and is required here.
  const child = spawn(ELECTRON_EXE, args, {
    cwd: ROOT,
    env,
    windowsHide: false,
    detached: true,
    stdio: 'ignore'
  })
  activePid = child.pid ?? null
  if (!child.pid) throw new Error('Electron failed to spawn (no pid)')

  let coldStartResolved = false
  let pollTimer: NodeJS.Timeout | null = null
  const coldStartPromise = new Promise<number>((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      if (coldStartResolved) return
      if (pollTimer) clearInterval(pollTimer)
      rejectPromise(
        new Error(
          `COLD_START_MS not found in startup.log within ${timeoutMs}ms; ` +
            `log tail: ${readStartupLog().slice(-1500)}`
        )
      )
    }, timeoutMs)

    const finish = (): boolean => {
      const output = readStartupLog()
      const match = output.match(/COLD_START_MS\s+(\d+)/)
      if (!match || coldStartResolved) return false
      coldStartResolved = true
      clearTimeout(timeout)
      if (pollTimer) clearInterval(pollTimer)
      resolvePromise(Number(match[1]))
      return true
    }

    pollTimer = setInterval(finish, 80)
    finish()

    child.once('error', (error) => {
      clearTimeout(timeout)
      if (pollTimer) clearInterval(pollTimer)
      if (!coldStartResolved) rejectPromise(error)
    })
    child.once('exit', (code, signal) => {
      if (coldStartResolved) return
      clearTimeout(timeout)
      if (pollTimer) clearInterval(pollTimer)
      rejectPromise(
        new Error(
          `Electron exited before COLD_START_MS (code=${code}, signal=${signal}); ` +
            `startup.log tail: ${readStartupLog().slice(-1500)}`
        )
      )
    })
  })

  // Avoid an unhandled rejection if the caller fails before awaiting the promise.
  coldStartPromise.catch(() => undefined)

  return {
    child,
    pid: child.pid,
    port,
    launchedAt,
    startupLogPath,
    startupLogOffset,
    coldStartPromise,
    startupLog: readStartupLog
  }
}

async function stopElectron(handle: LaunchHandle | null): Promise<void> {
  if (!handle) return
  killProcessTree(handle.pid)
  activePid = null
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    try {
      await fetchJson(`http://127.0.0.1:${handle.port}/json/version`, 500)
      await sleep(200)
    } catch {
      return
    }
  }
}

interface WorkingSetRow {
  pid: number
  name: string
  workingSetBytes: number
  type: string | null
}

async function readWorkingSets(
  processTypes: Map<number, string>
): Promise<{ method: string; rows: WorkingSetRow[]; totalBytes: number }> {
  const ids = [...processTypes.keys()]
  if (ids.length === 0) throw new Error('no CDP process ids to measure')
  const tempDir = join(RESULT_DIR, '.tmp')
  mkdirSync(tempDir, { recursive: true })
  const outputPath = join(
    tempDir,
    `processes-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 100000)}.json`
  )
  const script = [
    `$out=${psQuote(outputPath)}`,
    `$ids=@(${ids.join(',')})`,
    '$rows=@(Get-Process -Id $ids -ErrorAction SilentlyContinue | ForEach-Object {',
    '  [pscustomobject]@{ pid=$_.Id; name=$_.ProcessName; workingSetBytes=[int64]$_.WorkingSet64 }',
    '})',
    '$json=ConvertTo-Json -InputObject $rows -Compress -Depth 3',
    '[System.IO.File]::WriteAllText($out, $json, [System.Text.UTF8Encoding]::new($false))'
  ].join('; ')
  // Use no pipes: the DSH Windows sandbox can deny anonymous pipe creation
  // for child processes. The command writes JSON to a workspace file instead.
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { timeout: 20000, windowsHide: true, stdio: 'ignore' }
  )
  if (result.error) {
    rmSync(outputPath, { force: true })
    throw new Error(`Get-Process failed to start: ${result.error.message}`)
  }
  if (result.status !== 0) {
    rmSync(outputPath, { force: true })
    throw new Error(`Get-Process exited with code ${result.status}`)
  }
  let text = ''
  try {
    text = readFileSync(outputPath, 'utf8').replace(/^\uFEFF/, '').trim()
  } finally {
    rmSync(outputPath, { force: true })
  }
  if (!text) throw new Error('Get-Process returned no JSON')
  const parsed = JSON.parse(text)
  const rawRows = (Array.isArray(parsed) ? parsed : [parsed]) as {
    pid: number
    name: string
    workingSetBytes: number
  }[]
  const rows = rawRows.map((row) => ({
    pid: Number(row.pid),
    name: row.name,
    workingSetBytes: Number(row.workingSetBytes),
    type: processTypes.get(Number(row.pid)) ?? null
  }))
  return {
    method: 'cdp-system-info + powershell-get-process',
    rows,
    totalBytes: rows.reduce((sum, row) => sum + row.workingSetBytes, 0)
  }
}

interface MemoryStage {
  startup: {
    method: string
    processCount: number
    totalWorkingSetBytes: number
    mainWorkingSetBytes: number
    rendererWorkingSetBytes: number
    mainPlusRendererWorkingSetBytes: number
    mainPlusRendererProcessCount: number
    gpuWorkingSetBytes: number
    utilityWorkingSetBytes: number
    processes: WorkingSetRow[]
  } | null
  loaded: {
    method: string
    processCount: number
    totalWorkingSetBytes: number
    mainWorkingSetBytes: number
    rendererWorkingSetBytes: number
    mainPlusRendererWorkingSetBytes: number
    mainPlusRendererProcessCount: number
    gpuWorkingSetBytes: number
    utilityWorkingSetBytes: number
    processes: WorkingSetRow[]
  } | null
  rendererJsHeap: Record<string, number> | null
  error?: string
}

function summarizeMemory(
  sample: { method: string; rows: WorkingSetRow[]; totalBytes: number }
): NonNullable<MemoryStage['startup']> {
  const sumType = (type: string): number =>
    sample.rows
      .filter((row) => (row.type ?? '').toLowerCase() === type)
      .reduce((sum, row) => sum + row.workingSetBytes, 0)
  const mainPlusRenderer = sample.rows.filter((row) =>
    ['browser', 'renderer'].includes((row.type ?? '').toLowerCase())
  )
  return {
    method: sample.method,
    processCount: sample.rows.length,
    totalWorkingSetBytes: sample.totalBytes,
    mainWorkingSetBytes: sumType('browser'),
    rendererWorkingSetBytes: sumType('renderer'),
    mainPlusRendererWorkingSetBytes: mainPlusRenderer.reduce(
      (sum, row) => sum + row.workingSetBytes,
      0
    ),
    mainPlusRendererProcessCount: mainPlusRenderer.length,
    gpuWorkingSetBytes: sumType('gpu'),
    utilityWorkingSetBytes: sumType('utility'),
    processes: sample.rows
  }
}

async function collectProcessMemory(browserWsUrl: string): Promise<NonNullable<MemoryStage['startup']>> {
  const browserCdp = await connectCdp(browserWsUrl, 10000)
  try {
    const info = await browserCdp.send('SystemInfo.getProcessInfo', {}, 15000)
    const entries = (info?.processInfo ?? []) as { id?: number; type?: string }[]
    const types = new Map<number, string>()
    for (const entry of entries) {
      if (typeof entry.id === 'number') types.set(entry.id, String(entry.type ?? 'unknown').toLowerCase())
    }
    if (types.size === 0) throw new Error('SystemInfo.getProcessInfo returned no process ids')
    return summarizeMemory(await readWorkingSets(types))
  } finally {
    browserCdp.close()
  }
}

async function readBrowserGpuInfo(browserWsUrl: string): Promise<unknown> {
  const browserCdp = await connectCdp(browserWsUrl, 10000)
  try {
    const info = await browserCdp.send('SystemInfo.getInfo', {}, 15000)
    const gpu = info?.gpu
    return {
      devices: Array.isArray(gpu?.devices)
        ? gpu.devices.map((device: any) => ({
            vendorId: device?.vendorId ?? null,
            deviceId: device?.deviceId ?? null,
            vendorString: device?.vendorString ?? null,
            deviceString: device?.deviceString ?? null,
            driverVendor: device?.driverVendor ?? null,
            driverVersion: device?.driverVersion ?? null
          }))
        : null,
      featureStatus: gpu?.featureStatus ?? null,
      auxAttributes: gpu?.auxAttributes ?? null
    }
  } finally {
    browserCdp.close()
  }
}

interface ScrollState {
  rows: number
  loadedTasks: number
  virtualized: boolean
  hasButton: boolean
  buttonDisabled: boolean
  buttonText: string | null
  loadingText: boolean
  title: string
}

async function readScrollState(cdp: CdpClient): Promise<ScrollState> {
  return evaluate(
    cdp,
    `(() => {
      const button = document.querySelector('.load-more');
      const countText = (document.querySelector('.main-count')?.textContent || '').trim();
      const countMatch = countText.match(/[0-9]+/);
      const scroller = document.querySelector('.task-scroll');
      const totalRows = scroller?.getAttribute('data-total-rows');
      return {
        rows: document.querySelectorAll('.task-row').length,
        loadedTasks: totalRows ? Number(totalRows) : countMatch ? Number(countMatch[0]) : 0,
        virtualized: scroller?.getAttribute('data-virtualized') === 'true',
        hasButton: !!button,
        buttonDisabled: !!(button && button.disabled),
        buttonText: button ? button.textContent.trim() : null,
        loadingText: !!document.querySelector('.list-loading'),
        title: (document.querySelector('.main-title h1')?.textContent || '').trim()
      };
    })()`
  )
}

interface UiStage {
  ok: boolean
  view: string
  requestedTargetRows: number
  effectiveTargetRows: number
  loadedTasks: number
  rows: number
  virtualized: boolean
  loadMoreClicks: number
  scrollHeight: number
  clientHeight: number
  scrollRange: number
  fps: number | null
  elapsedMs: number | null
  frameCount: number | null
  longestFrameMs: number | null
  p95FrameMs: number | null
  fps60HitRate: number | null
  fps50HitRate: number | null
  rendererJsHeap: Record<string, number> | null
  visibilityState: string | null
  error?: string
}

interface E2eMeasurement {
  cdpReadyMs: number
  firstEvaluateMs: number
  firstTaskRowMs: number
  initialRows: number
}

async function measureFirstTaskRow(
  port: number,
  launchedAt: number
): Promise<E2eMeasurement> {
  const page = await waitForPageTarget(port, APP_TIMEOUT_MS)
  const cdp = await connectCdp(page.webSocketDebuggerUrl, 15000)
  const cdpReadyMs = Date.now() - launchedAt
  try {
    await cdp.send('Page.bringToFront', {}, 10000).catch(() => undefined)
    const firstEvaluateMs = Date.now() - launchedAt
    let rows = 0
    await waitUntil(
      async () => {
        const state = await evaluate(
          cdp,
          `(() => ({
            rows: document.querySelectorAll('.task-row').length,
            ready: document.readyState === 'complete'
          }))()`
        )
        rows = Number(state?.rows ?? 0)
        return state?.ready === true && rows > 0
      },
      APP_TIMEOUT_MS,
      'first task row'
    )
    return {
      cdpReadyMs,
      firstEvaluateMs,
      firstTaskRowMs: Date.now() - launchedAt,
      initialRows: rows
    }
  } finally {
    cdp.close()
  }
}

async function runUiStage(
  handle: LaunchHandle
): Promise<{ ui: UiStage; loadedMemory: NonNullable<MemoryStage['startup']> | null }> {
  const page = await waitForPageTarget(handle.port, APP_TIMEOUT_MS)
  const cdp = await connectCdp(page.webSocketDebuggerUrl, 15000)
  const effectiveTarget = Math.min(TARGET_ROWS, dataset.activeAll)
  let clicks = 0
  let loadedMemory: NonNullable<MemoryStage['startup']> | null = null
  try {
    await cdp.send('Runtime.enable', {}, 10000)
    await cdp.send('Page.bringToFront', {}, 10000).catch(() => undefined)

    await waitUntil(
      async () =>
        Boolean(
          await evaluate(
            cdp,
            `document.readyState === 'complete' && !!document.querySelector('.sidebar') && !!document.querySelector('.main-title h1')`
          )
        ),
      APP_TIMEOUT_MS,
      'renderer application shell'
    )

    const clickResult = await evaluate(
      cdp,
      `(() => {
        const items = Array.from(document.querySelectorAll('.nav-item'));
        const el = items.find((item) => (item.textContent || '').replace(/\\s+/g, '').startsWith('全部'));
        if (!el) return { ok: false, labels: items.map((item) => (item.textContent || '').trim()) };
        el.click();
        return { ok: true, label: (el.textContent || '').trim() };
      })()`
    )
    if (!clickResult?.ok) {
      throw new Error(`could not find the 全部 navigation item: ${JSON.stringify(clickResult?.labels)}`)
    }

    await waitUntil(
      async () => {
        const state = await readScrollState(cdp)
        return state.title === '全部' && state.rows > 0 && !state.loadingText
      },
      APP_TIMEOUT_MS,
      '全部 view with initial tasks'
    )

    let previousLoaded = -1
    let stalledRounds = 0
    for (let round = 0; round < 60; round += 1) {
      const state = await readScrollState(cdp)
      if (state.loadedTasks >= effectiveTarget) break
      if (!state.hasButton) break
      if (state.buttonDisabled) {
        await sleep(100)
        continue
      }
      if (state.loadedTasks === previousLoaded) {
        stalledRounds += 1
        if (stalledRounds >= 3) break
      } else {
        stalledRounds = 0
        previousLoaded = state.loadedTasks
      }
      const beforeLoaded = state.loadedTasks
      const beforeDomRows = state.rows
      const clicked = await evaluate(
        cdp,
        `(() => {
          const button = document.querySelector('.load-more');
          if (!button || button.disabled) return false;
          button.click();
          return true;
        })()`
      )
      if (clicked) clicks += 1
      await waitUntil(
        async () => {
          const next = await readScrollState(cdp)
          return (
            next.loadedTasks > beforeLoaded ||
            next.rows > beforeDomRows ||
            (!next.hasButton && !next.buttonDisabled)
          )
        },
        30000,
        'load-more page'
      )
    }

    await waitUntil(
      async () => (await readScrollState(cdp)).rows > 0,
      15000,
      'rendered task rows after loading'
    )

    let domStats: any = null
    const scrollDeadline = Date.now() + 15000
    while (Date.now() < scrollDeadline) {
      domStats = await evaluate(
        cdp,
        `(() => {
          const el = document.querySelector('.task-scroll');
          if (!el) throw new Error('.task-scroll not found');
          const countText = (document.querySelector('.main-count')?.textContent || '').trim();
          const countMatch = countText.match(/[0-9]+/);
          const totalRows = el.getAttribute('data-total-rows');
          return {
            rows: document.querySelectorAll('.task-row').length,
            loadedTasks: totalRows ? Number(totalRows) : countMatch ? Number(countMatch[0]) : 0,
            virtualized: el.getAttribute('data-virtualized') === 'true',
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
            scrollRange: Math.max(0, el.scrollHeight - el.clientHeight),
            visibilityState: document.visibilityState
          };
        })()`
      )
      if (domStats?.rows > 0 && domStats.scrollRange > 0) break
      await sleep(200)
    }
    if (!domStats?.rows) throw new Error('no .task-row elements after loading')
    if (domStats.scrollRange <= 0) throw new Error('task list is not scrollable')

    const fpsResult = await evaluate(
      cdp,
      `(async () => {
        const el = document.querySelector('.task-scroll');
        if (!el) throw new Error('.task-scroll not found');
        const duration = ${FPS_DURATION_MS};
        const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
        el.scrollTop = 0;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const deltas = [];
        let frames = 0;
        let last = null;
        const start = performance.now();
        await new Promise((resolve) => {
          function tick(timestamp) {
            frames += 1;
            if (last !== null) deltas.push(timestamp - last);
            last = timestamp;
            const progress = Math.min(1, (timestamp - start) / duration);
            el.scrollTop = maxScroll * progress;
            if (progress >= 1) resolve();
            else requestAnimationFrame(tick);
          }
          requestAnimationFrame(tick);
        });
        const elapsed = Math.max(0.001, last - start);
        const sorted = [...deltas].sort((a, b) => a - b);
        const pct = (p) => {
          if (!sorted.length) return null;
          const rank = (sorted.length - 1) * p;
          const lo = Math.floor(rank);
          const hi = Math.ceil(rank);
          return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
        };
        return {
          fps: deltas.length / (elapsed / 1000),
          elapsedMs: elapsed,
          frameCount: frames,
          longestFrameMs: sorted.length ? sorted[sorted.length - 1] : null,
          p95FrameMs: pct(0.95),
          fps60HitRate: deltas.length ? deltas.filter((dt) => dt <= 17).length / deltas.length : null,
          fps50HitRate: deltas.length ? deltas.filter((dt) => dt <= 20).length / deltas.length : null,
          finalScrollTop: el.scrollTop,
          maxScroll
        };
      })()`,
      true,
      60000
    )

    const heap = await evaluate(
      cdp,
      `(() => {
        const memory = performance.memory;
        if (!memory) return null;
        return {
          usedJSHeapSize: memory.usedJSHeapSize,
          totalJSHeapSize: memory.totalJSHeapSize,
          jsHeapSizeLimit: memory.jsHeapSizeLimit
        };
      })()`
    )

    // Sample while the app still owns the fully loaded DOM.
    try {
      const version = (await fetchJson(`http://127.0.0.1:${handle.port}/json/version`)) as {
        webSocketDebuggerUrl?: string
      }
      if (version?.webSocketDebuggerUrl) {
        loadedMemory = await collectProcessMemory(version.webSocketDebuggerUrl)
      }
    } catch (error) {
      console.error(`process-memory (loaded) failed: ${String(error)}`)
    }

    return {
      ui: {
        ok: true,
        view: '全部',
        requestedTargetRows: TARGET_ROWS,
        effectiveTargetRows: effectiveTarget,
        loadedTasks: Number(domStats.loadedTasks),
        rows: Number(domStats.rows),
        virtualized: domStats.virtualized === true,
        loadMoreClicks: clicks,
        scrollHeight: Number(domStats.scrollHeight),
        clientHeight: Number(domStats.clientHeight),
        scrollRange: Number(domStats.scrollRange),
        fps: round(Number(fpsResult.fps), 2),
        elapsedMs: round(Number(fpsResult.elapsedMs), 2),
        frameCount: Number(fpsResult.frameCount),
        longestFrameMs: round(Number(fpsResult.longestFrameMs), 2),
        p95FrameMs: round(Number(fpsResult.p95FrameMs), 2),
        fps60HitRate:
          fpsResult.fps60HitRate === null ? null : round(Number(fpsResult.fps60HitRate), 4),
        fps50HitRate:
          fpsResult.fps50HitRate === null ? null : round(Number(fpsResult.fps50HitRate), 4),
        rendererJsHeap: heap ?? null,
        visibilityState: domStats.visibilityState ?? null
      },
      loadedMemory
    }
  } finally {
    cdp.close()
  }
}

interface ColdRun {
  run: number
  coldStartMs: number | null
  coldStartE2EMs: number | null
  cdpReadyMs: number | null
  firstEvaluateMs: number | null
  initialRows: number | null
  ok: boolean
  error?: string
  e2eError?: string
}

interface AppStageResult {
  ok: boolean
  runsRequested: number
  coldRuns: ColdRun[]
  coldStartP50Ms: number | null
  coldStartP95Ms: number | null
  coldStartE2EP50Ms: number | null
  coldStartE2EP95Ms: number | null
  ui: UiStage | null
  memory: MemoryStage | null
  gpu: unknown
  error?: string
}

function summarizeCold(
  coldRuns: ColdRun[],
  key: 'coldStartMs' | 'coldStartE2EMs'
): { p50: number | null; p95: number | null } {
  const samples = coldRuns
    .map((run) => run[key])
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b)
  if (!samples.length) return { p50: null, p95: null }
  return { p50: round(percentile(samples, 0.5)), p95: round(percentile(samples, 0.95)) }
}

async function runAppStage(): Promise<AppStageResult> {
  const result: AppStageResult = {
    ok: false,
    runsRequested: APP_RUNS,
    coldRuns: [],
    coldStartP50Ms: null,
    coldStartP95Ms: null,
    coldStartE2EP50Ms: null,
    coldStartE2EP95Ms: null,
    ui: null,
    memory: null,
    gpu: null
  }
  let uiAttempted = false
  let memory: MemoryStage = { startup: null, loaded: null, rendererJsHeap: null }
  let lastError = ''

  for (let run = 1; run <= APP_RUNS; run += 1) {
    let handle: LaunchHandle | null = null
    let coldEntry: ColdRun | null = null
    try {
      const port = await choosePort()
      handle = await launchElectron(port, APP_TIMEOUT_MS, run)
      const coldStart = await handle.coldStartPromise
      coldEntry = {
        run,
        coldStartMs: coldStart,
        coldStartE2EMs: null,
        cdpReadyMs: null,
        firstEvaluateMs: null,
        initialRows: null,
        ok: true
      }
      result.coldRuns.push(coldEntry)

      const e2e = await measureFirstTaskRow(port, handle.launchedAt)
      coldEntry.coldStartE2EMs = e2e.firstTaskRowMs
      coldEntry.cdpReadyMs = e2e.cdpReadyMs
      coldEntry.firstEvaluateMs = e2e.firstEvaluateMs
      coldEntry.initialRows = e2e.initialRows

      const version = (await fetchJson(`http://127.0.0.1:${port}/json/version`)) as {
        webSocketDebuggerUrl?: string
        Browser?: string
      }
      if (!version?.webSocketDebuggerUrl) throw new Error('browser webSocketDebuggerUrl is missing')

      if (!uiAttempted) {
        uiAttempted = true
        try {
          const startupMemory = await collectProcessMemory(version.webSocketDebuggerUrl)
          memory.startup = startupMemory
        } catch (error) {
          memory.error = `startup memory: ${String(error)}`
        }
        try {
          if (!result.gpu) result.gpu = await readBrowserGpuInfo(version.webSocketDebuggerUrl)
        } catch (error) {
          console.error(`GPU info failed: ${String(error)}`)
        }
        try {
          const uiRun = await runUiStage(handle)
          result.ui = uiRun.ui
          if (uiRun.loadedMemory) memory.loaded = uiRun.loadedMemory
          memory.rendererJsHeap = uiRun.ui.rendererJsHeap
        } catch (error) {
          lastError = error instanceof Error ? error.stack ?? error.message : String(error)
          result.ui = {
            ok: false,
            view: '全部',
            requestedTargetRows: TARGET_ROWS,
            effectiveTargetRows: Math.min(TARGET_ROWS, dataset.activeAll),
            loadedTasks: 0,
            rows: 0,
            virtualized: false,
            loadMoreClicks: 0,
            scrollHeight: 0,
            clientHeight: 0,
            scrollRange: 0,
            fps: null,
            elapsedMs: null,
            frameCount: null,
            longestFrameMs: null,
            p95FrameMs: null,
            fps60HitRate: null,
            fps50HitRate: null,
            rendererJsHeap: null,
            visibilityState: null,
            error: lastError
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error)
      lastError = message
      if (coldEntry) {
        coldEntry.e2eError = message.slice(0, 4000)
      } else {
        result.coldRuns.push({
          run,
          coldStartMs: null,
          coldStartE2EMs: null,
          cdpReadyMs: null,
          firstEvaluateMs: null,
          initialRows: null,
          ok: false,
          error: message.slice(0, 4000)
        })
      }
    } finally {
      await stopElectron(handle)
      await sleep(250)
    }
  }

  result.memory = memory
  const cold = summarizeCold(result.coldRuns, 'coldStartMs')
  const e2e = summarizeCold(result.coldRuns, 'coldStartE2EMs')
  result.coldStartP50Ms = cold.p50
  result.coldStartP95Ms = cold.p95
  result.coldStartE2EP50Ms = e2e.p50
  result.coldStartE2EP95Ms = e2e.p95
  result.ok =
    result.coldRuns.some((run) => run.coldStartMs !== null) &&
    result.coldRuns.some((run) => run.coldStartE2EMs !== null) &&
    result.ui !== null &&
    result.ui.ok === true &&
    memory.startup !== null
  if (!result.ok && lastError) {
    const dshHint = /code=2147483651/.test(lastError)
      ? '\n\n环境诊断：Electron 在受限会话中提前退出。启动使用 stdio:ignore，' +
        '已清空 ELECTRON_RUN_AS_NODE，并传入 --no-sandbox/--disable-gpu；' +
        '若仍失败，应在允许 GUI 子进程与 Chromium IPC 的交互式会话中复测。'
      : ''
    result.error = lastError + dshHint
  }
  if (!result.ok && !result.error) result.error = 'app benchmark did not complete'
  return result
}

function formatMs(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? '未测' : value.toFixed(3)
}

function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return '未测'
  return `${value} (${round(value / 1024 / 1024, 2)} MiB)`
}

function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? '未测' : `${round(value * 100, 2)}%`
}

interface Report {
  schemaVersion: 1
  generatedAt: string
  tool: string
  appVersion: string
  environment: Record<string, unknown>
  dataset: DatasetMeta & { dataDir: string; targetRows: number }
  db: DbStageResult | null
  app: AppStageResult | null
  notes: string[]
}

function markdown(report: Report): string {
  const lines: string[] = []
  lines.push('# LightTodo 性能基准（自动生成）')
  lines.push('')
  lines.push(`生成时间：${report.generatedAt}`)
  lines.push('')
  lines.push('> 本报告只代表当前机器、当前构建和当前运行条件；不是干净 Win11 的发布基线。')
  lines.push('')
  lines.push('## 环境')
  lines.push('')
  lines.push('| 项 | 值 |')
  lines.push('| --- | --- |')
  const env = report.environment
  for (const [key, value] of Object.entries(env)) {
    const text =
      typeof value === 'object' ? JSON.stringify(value) : String(value).replace(/\|/g, '\\|')
    lines.push(`| ${key} | ${text} |`)
  }
  lines.push('')
  lines.push('## 数据集')
  lines.push('')
  lines.push('| 项 | 值 |')
  lines.push('| --- | --- |')
  lines.push(`| 目录 | ${report.dataset.dataDir.replace(/\|/g, '\\|')} |`)
  lines.push(`| 总任务数 | ${report.dataset.total} |`)
  lines.push(`| 全部视图可见（活动顶层） | ${report.dataset.activeAll} |`)
  lines.push(`| 已完成 / 回收站 | ${report.dataset.completed} / ${report.dataset.trash} |`)
  lines.push(`| 清单 / 标签 | ${report.dataset.lists} / ${report.dataset.tags} |`)
  lines.push(`| DB 文件 | ${formatBytes(report.dataset.databaseBytes)} |`)
  lines.push('')

  if (report.db) {
    lines.push('## SQLite / DB 基准')
    lines.push('')
    lines.push(`预热 1 次，测量 ${report.db.runs} 次；P50/P95 为线性插值。单位 ms。`)
    lines.push('')
    lines.push('| 查询 | API | 返回行数 | P50 | P95 | min | max |')
    lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: |')
    for (const query of report.db.queries) {
      lines.push(
        `| ${query.label} | \`${query.api}\` | ${query.rows ?? '—'} | ${query.p50Ms.toFixed(3)} | ` +
          `${query.p95Ms.toFixed(3)} | ${query.minMs.toFixed(3)} | ${query.maxMs.toFixed(3)} |`
      )
    }
    if (!report.db.ok) lines.push('', `**DB 阶段失败：** ${report.db.error ?? 'unknown error'}`)
    lines.push('')
  } else {
    lines.push('## SQLite / DB 基准')
    lines.push('')
    lines.push('未测（--skip-db）。')
    lines.push('')
  }

  if (report.app) {
    lines.push('## 冷启动')
    lines.push('')
    lines.push('| run | COLD_START_MS | E2E 到首行 | 初始行数 | 状态 |')
    lines.push('| ---: | ---: | ---: | ---: | --- |')
    for (const run of report.app.coldRuns) {
      const status = run.ok
        ? run.e2eError
          ? `E2E 失败：${run.e2eError.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 300)}`
          : 'ok'
        : `失败：${(run.error ?? '')
            .replace(/\|/g, '\\|')
            .replace(/\r?\n/g, ' ')
            .slice(0, 500)}`
      lines.push(
        `| ${run.run} | ${run.coldStartMs ?? '—'} | ${run.coldStartE2EMs ?? '—'} | ` +
          `${run.initialRows ?? '—'} | ${status} |`
      )
    }
    lines.push('')
    lines.push(
      `ready-to-show：P50 = ${formatMs(report.app.coldStartP50Ms)} ms，` +
        `P95 = ${formatMs(report.app.coldStartP95Ms)} ms。`
    )
    lines.push(
      `端到端（spawn → CDP 首次看到 .task-row）：P50 = ` +
        `${formatMs(report.app.coldStartE2EP50Ms)} ms，P95 = ${formatMs(report.app.coldStartE2EP95Ms)} ms。`
    )
    lines.push('')
    lines.push('## 列表滚动 / DOM')
    lines.push('')
    if (report.app.ui?.ok) {
      const ui = report.app.ui
      lines.push('| 指标 | 值 |')
      lines.push('| --- | ---: |')
      lines.push(`| 视图 | ${ui.view} |`)
      lines.push(`| 目标 / 已加载任务 | ${ui.requestedTargetRows} / ${ui.loadedTasks} |`)
      lines.push(`| 实际 .task-row DOM 行数 | ${ui.rows} |`)
      lines.push(`| 虚拟列表 | ${ui.virtualized ? '是' : '否'} |`)
      lines.push(`| scrollHeight / clientHeight | ${ui.scrollHeight} / ${ui.clientHeight} |`)
      lines.push(`| FPS | ${ui.fps ?? '未测'} |`)
      lines.push(`| 测量时长 | ${ui.elapsedMs ?? '未测'} ms |`)
      lines.push(`| 最长帧 | ${ui.longestFrameMs ?? '未测'} ms |`)
      lines.push(`| P95 帧间隔 | ${ui.p95FrameMs ?? '未测'} ms |`)
      lines.push(`| 约 60fps 达成率（帧间隔 ≤17ms） | ${formatPercent(ui.fps60HitRate)} |`)
      lines.push(`| ≥50fps 达成率（帧间隔 ≤20ms） | ${formatPercent(ui.fps50HitRate)} |`)
      lines.push(`| performance.memory.usedJSHeapSize | ${formatBytes(ui.rendererJsHeap?.usedJSHeapSize)} |`)
    } else {
      lines.push(report.app.ui?.error ?? '未测（应用阶段失败）。')
    }
    lines.push('')
    lines.push('## 内存')
    lines.push('')
    lines.push('单位：WorkingSet64。汇总值包含主进程、渲染进程、GPU/utility 等子进程；共享页会被重复计入。')
    lines.push('')
    lines.push(
      '| 时点 | 总进程数 | 合计 | 主+渲染合计 | 主+渲染进程数 | 主进程 | 渲染进程 | GPU | utility | 方法 |'
    )
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |')
    for (const [label, sample] of [
      ['启动后（未加载全量）', report.app.memory?.startup],
      ['加载列表后', report.app.memory?.loaded]
    ] as const) {
      lines.push(
        sample
          ? `| ${label} | ${sample.processCount} | ${formatBytes(sample.totalWorkingSetBytes)} | ` +
              `${formatBytes(sample.mainPlusRendererWorkingSetBytes)} | ${sample.mainPlusRendererProcessCount} | ` +
              `${formatBytes(sample.mainWorkingSetBytes)} | ${formatBytes(sample.rendererWorkingSetBytes)} | ` +
              `${formatBytes(sample.gpuWorkingSetBytes)} | ${formatBytes(sample.utilityWorkingSetBytes)} | ${sample.method} |`
          : `| ${label} | 未测 | 未测 | 未测 | 未测 | 未测 | 未测 | 未测 | 未测 | — |`
      )
    }
    if (report.app.memory?.error) lines.push('', `**内存阶段错误：** ${report.app.memory.error}`)
    lines.push('')
    if (report.app.error) {
      lines.push('**应用阶段错误：**')
      lines.push('')
      lines.push('```')
      lines.push(report.app.error)
      lines.push('```')
      lines.push('')
    }
  } else {
    lines.push('## 应用基准')
    lines.push('')
    lines.push('未测（--skip-app）。')
    lines.push('')
  }

  lines.push('## 解释与限制')
  lines.push('')
  for (const note of report.notes) lines.push(`- ${note}`)
  lines.push('')
  return lines.join('\n')
}

function consoleReport(report: Report): void {
  console.log('')
  console.log('LightTodo performance benchmark')
  console.log(`generated: ${report.generatedAt}`)
  console.log(
    `dataset: ${report.dataset.total} tasks, ${report.dataset.activeAll} active in 全部, ` +
      `${report.dataset.lists} lists, ${report.dataset.tags} tags`
  )
  console.log('')
  if (report.db) {
    console.log('DB (ms, P50/P95)')
    console.log(
      `${'query'.padEnd(24)} ${'rows'.padStart(7)} ${'P50'.padStart(9)} ${'P95'.padStart(9)}`
    )
    for (const query of report.db.queries) {
      console.log(
        `${query.label.padEnd(24)} ${String(query.rows ?? '-').padStart(7)} ` +
          `${query.p50Ms.toFixed(3).padStart(9)} ${query.p95Ms.toFixed(3).padStart(9)}`
      )
    }
    console.log('')
  }
  if (report.app) {
    console.log('App cold start (ms)')
    for (const run of report.app.coldRuns) {
      console.log(
        `  run ${run.run}: ready=${run.coldStartMs ?? 'FAILED'} e2e=${run.coldStartE2EMs ?? 'FAILED'}` +
          `${run.error ? ` (${run.error.slice(0, 120)})` : ''}`
      )
    }
    console.log(
      `  ready-to-show P50 ${formatMs(report.app.coldStartP50Ms)}  P95 ${formatMs(report.app.coldStartP95Ms)}`
    )
    console.log(
      `  e2e          P50 ${formatMs(report.app.coldStartE2EP50Ms)}  P95 ${formatMs(report.app.coldStartE2EP95Ms)}`
    )
    if (report.app.ui?.ok) {
      const ui = report.app.ui
      console.log('')
      console.log(
        `List: ${ui.loadedTasks} loaded tasks, ${ui.rows} DOM rows ` +
          `(virtualized=${ui.virtualized ? 'yes' : 'no'}), ${ui.loadMoreClicks} load-more clicks, ` +
          `${ui.scrollHeight}/${ui.clientHeight}px, FPS ${ui.fps}, ` +
          `longest ${ui.longestFrameMs}ms, 60fps hit ${formatPercent(ui.fps60HitRate)}`
      )
    } else if (report.app.ui?.error) {
      console.log(`UI FAILED: ${report.app.ui.error}`)
    }
    if (report.app.memory?.startup || report.app.memory?.loaded) {
      console.log('')
      console.log('Memory (WorkingSet64)')
      for (const [label, sample] of [
        ['startup', report.app.memory.startup],
        ['loaded', report.app.memory.loaded]
      ] as const) {
        if (sample) {
          console.log(
            `  ${label}: ${sample.processCount} processes, total ${formatBytes(sample.totalWorkingSetBytes)}, ` +
              `main+renderer ${formatBytes(sample.mainPlusRendererWorkingSetBytes)} ` +
              `(${sample.mainPlusRendererProcessCount} processes), main ${formatBytes(sample.mainWorkingSetBytes)}, ` +
              `renderer ${formatBytes(sample.rendererWorkingSetBytes)}`
          )
        }
      }
    }
  }
  console.log('')
  console.log(`JSON: ${JSON_PATH}`)
  console.log(`Markdown: ${MD_PATH}`)
}

const report: Report = {
  schemaVersion: 1,
  generatedAt: STARTED_AT.toISOString(),
  tool: 'scripts/bench-perf.ts',
  appVersion: appVersion(),
  environment: {
    os: `${process.platform} ${release()}`,
    arch: arch(),
    hostname: hostname(),
    node: process.version,
    electron: electronVersion(),
    cpu: cpus()[0]?.model?.trim() ?? 'unknown',
    logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(),
    session: process.env.SESSIONNAME ?? null,
    launchArgs:
      'electron.exe --no-sandbox --disable-gpu --enable-precise-memory-info --remote-debugging-port=<free> .',
    launchMode: 'detached:true, stdio:ignore; COLD_START_MS read from userdata/startup.log',
    gpuFlag:
      '--disable-gpu (software rendering / no hardware acceleration); --no-sandbox is also always passed',
    cdp: 'remote debugging over loopback',
    dataDirKind: 'isolated workspace directory'
  },
  dataset: {
    ...dataset,
    dataDir: DATA_DIR,
    targetRows: TARGET_ROWS
  },
  db: null,
  app: null,
  notes: [
    'COLD_START_MS 是应用进程 T0 到 BrowserWindow ready-to-show 的墙钟时间；没有重启系统或清空 OS 文件缓存，不等于干净 Win11 的冷开机基线。',
    'coldStartE2EMs 是父进程 spawn 起算，到 CDP Runtime.evaluate 首次观察到 .task-row > 0 的时间；它额外包含渲染器启动、首批 IPC 数据和 React 首屏渲染。',
    'FPS 是对 .task-scroll 从顶部到底部的 2 秒 requestAnimationFrame 滚动；fps = 帧间隔数 / 测量秒数，60fps 达成率定义为帧间隔 ≤17ms，50fps 达成率为 ≤20ms。',
    '启动时显式传入 --no-sandbox 和 --disable-gpu，当前环境为软件渲染；GPU 合成、Mica 和真实显示器刷新率影响未被覆盖。',
    'Electron 使用 detached + stdio:ignore 启动，COLD_START_MS 从 LIGHTTODO_DATA_DIR/userdata/startup.log 的本次运行增量中读取。',
    '进程内存来自 CDP SystemInfo.getProcessInfo 的 PID，再用 PowerShell Get-Process 读取 WorkingSet64；CDP 不可用时不会伪造数字。',
    'WorkingSet64 求和会重复计算共享页，不能等同于私有提交内存或任务管理器“内存”列。',
    'SQLite 是热连接、同一进程、WAL 已建立的读取；没有覆盖磁盘冷缓存、并发写、锁等待或大数据导入。'
  ]
}

async function main(): Promise<void> {
  mkdirSync(RESULT_DIR, { recursive: true })
  mkdirSync(dirname(JSON_PATH), { recursive: true })
  mkdirSync(dirname(MD_PATH), { recursive: true })

  if (!SKIP_DB) {
    console.log(`DB stage: ${dataset.total} tasks in ${DATA_DIR}`)
    report.db = runDbStage()
    if (report.db.ok) {
      for (const query of report.db.queries) {
        console.log(
          `  ${query.label}: P50 ${query.p50Ms.toFixed(3)}ms, P95 ${query.p95Ms.toFixed(3)}ms, rows ${query.rows ?? '-'}`
        )
      }
    } else {
      console.error(`DB stage failed: ${report.db.error}`)
    }
  }

  if (!SKIP_APP) {
    if (!existsSync(ELECTRON_EXE)) fail(`electron executable not found: ${ELECTRON_EXE}`)
    console.log(`App stage: ${APP_RUNS} launch(es), target rows ${TARGET_ROWS}`)
    report.app = await runAppStage()
    if (report.app.ui) {
      console.log(
        `  cold start P50 ${formatMs(report.app.coldStartP50Ms)}ms, P95 ${formatMs(report.app.coldStartP95Ms)}ms; ` +
          `e2e P50 ${formatMs(report.app.coldStartE2EP50Ms)}ms, P95 ${formatMs(report.app.coldStartE2EP95Ms)}ms`
      )
      if (report.app.ui.ok) {
        console.log(
          `  UI rows ${report.app.ui.rows}, FPS ${report.app.ui.fps}, longest ${report.app.ui.longestFrameMs}ms`
        )
      }
    }
    if (!report.app.ok) console.error(`App stage incomplete: ${report.app.error}`)
  }

  if (report.app && !report.app.ok && report.app.error) {
    report.notes.push(
      `本次应用阶段未完成，不能把 DB 数字当作端到端基线；失败原因见“应用阶段错误”。`
    )
  }
  const ok = (SKIP_DB || report.db?.ok === true) && (SKIP_APP || report.app?.ok === true)
  writeFileSync(JSON_PATH, JSON.stringify(report, null, 2), 'utf8')
  writeFileSync(MD_PATH, markdown(report), 'utf8')
  consoleReport(report)
  if (!ok) process.exitCode = 1
}

main().catch((error) => {
  killProcessTree(activePid)
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
