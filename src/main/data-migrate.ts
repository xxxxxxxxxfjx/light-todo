import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { validateDatabaseFile } from './db-file.ts'

export interface LegacyCandidate {
  path: string
  tasks: number
  mtime: number
}

export interface MigrationResult {
  migrated: boolean
  from?: string
  tasks?: number
}

function countTasks(path: string): number {
  let db: DatabaseSync | null = null
  try {
    db = new DatabaseSync(path, { readOnly: true })
    const row = db.prepare('SELECT COUNT(*) AS count FROM tasks').get() as
      | { count: number | null }
      | undefined
    return Number(row?.count ?? 0)
  } catch {
    return 0
  } finally {
    try {
      db?.close()
    } catch {
      /* ignore */
    }
  }
}

function addCandidate(dirs: Set<string>, dir: string | null | undefined): void {
  if (dir) dirs.add(dir)
}

export interface MigrationSearch {
  currentDir: string
  appDataDir: string
  executableDir: string | null
  homeDir?: string | null
  localAppDataDir?: string | null
}

function addPortableRoot(dirs: Set<string>, root: string | null | undefined): void {
  if (!root) return
  addCandidate(dirs, join(root, 'LightTodoData'))
  addCandidate(dirs, root)
  try {
    for (const entry of readdirSync(root, { withFileTypes: true }).slice(0, 80)) {
      if (!entry.isDirectory()) continue
      addCandidate(dirs, join(root, entry.name, 'LightTodoData'))
    }
  } catch {
    /* best effort */
  }
}

function candidateDirectories(opts: MigrationSearch): string[] {
  const dirs = new Set<string>()
  addCandidate(dirs, join(opts.appDataDir, 'LightTodo'))
  addCandidate(dirs, join(opts.appDataDir, 'lighttodo'))
  addCandidate(dirs, join(opts.appDataDir, 'Electron'))
  addCandidate(dirs, dirname(opts.currentDir))
  addCandidate(dirs, join(dirname(opts.currentDir), 'LightTodoData'))

  if (opts.localAppDataDir) {
    addCandidate(dirs, join(opts.localAppDataDir, 'LightTodo'))
    addCandidate(dirs, join(opts.localAppDataDir, 'lighttodo'))
    addCandidate(dirs, join(opts.localAppDataDir, 'Programs', 'LightTodo'))
    addCandidate(dirs, join(opts.localAppDataDir, 'Programs', 'lighttodo'))
  }

  if (opts.executableDir) {
    addPortableRoot(dirs, opts.executableDir)
    addPortableRoot(dirs, dirname(opts.executableDir))
  }

  // Common places a user may have kept the portable folder before installing.
  if (opts.homeDir) {
    for (const name of ['Downloads', 'Desktop', 'Documents', 'OneDrive/Desktop', 'OneDrive/Documents']) {
      addPortableRoot(dirs, join(opts.homeDir, name))
    }
  }

  // Any first-level folder under %APPDATA% that still carries a lighttodo.db.
  try {
    for (const entry of readdirSync(opts.appDataDir, { withFileTypes: true }).slice(0, 200)) {
      if (entry.isDirectory()) addCandidate(dirs, join(opts.appDataDir, entry.name))
    }
  } catch {
    /* best effort */
  }
  return [...dirs]
}

/** Find every non-empty 轻单 database outside the current data directory. */
export function findLegacyDatabases(opts: MigrationSearch): LegacyCandidate[] {
  const currentPath = join(opts.currentDir, 'lighttodo.db')
  const found: LegacyCandidate[] = []
  const seen = new Set<string>()
  for (const dir of candidateDirectories(opts)) {
    const path = join(dir, 'lighttodo.db')
    if (path === currentPath || seen.has(path) || !existsSync(path)) continue
    seen.add(path)
    if (!validateDatabaseFile(path).ok) continue
    const tasks = countTasks(path)
    if (tasks <= 0) continue
    try {
      found.push({ path, tasks, mtime: statSync(path).mtimeMs })
    } catch {
      /* ignore unreadable candidates */
    }
  }
  found.sort((a, b) => b.mtime - a.mtime)
  return found
}

/** Find the newest non-empty 轻单 database outside the current data directory. */
export function findLegacyDatabase(opts: MigrationSearch): LegacyCandidate | null {
  return findLegacyDatabases(opts)[0] ?? null
}

/**
 * If the current database is missing/empty, copy the newest legacy database in.
 * The old file is left untouched; the current one (if any) is renamed aside.
 */
export function migrateLegacyDatabase(opts: MigrationSearch): MigrationResult {
  const currentPath = join(opts.currentDir, 'lighttodo.db')
  const currentTasks = existsSync(currentPath) ? countTasks(currentPath) : 0
  if (currentTasks > 0) return { migrated: false }

  const legacy = findLegacyDatabase(opts)
  if (!legacy) return { migrated: false }

  mkdirSync(opts.currentDir, { recursive: true })
  if (existsSync(currentPath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    renameSync(currentPath, `${currentPath}.empty-${stamp}`)
  }
  copyFileSync(legacy.path, currentPath)
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = legacy.path + suffix
    if (existsSync(sidecar)) copyFileSync(sidecar, currentPath + suffix)
  }
  if (!validateDatabaseFile(currentPath).ok) return { migrated: false }
  return { migrated: true, from: legacy.path, tasks: legacy.tasks }
}
