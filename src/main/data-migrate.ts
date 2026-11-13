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

function candidateDirectories(
  currentDir: string,
  appDataDir: string,
  executableDir: string | null
): string[] {
  const dirs = new Set<string>()
  addCandidate(dirs, join(appDataDir, 'LightTodo'))
  addCandidate(dirs, join(appDataDir, 'lighttodo'))
  addCandidate(dirs, join(appDataDir, 'Electron'))
  addCandidate(dirs, dirname(currentDir))
  addCandidate(dirs, join(dirname(currentDir), 'LightTodoData'))

  if (executableDir) {
    addCandidate(dirs, join(executableDir, 'LightTodoData'))
    const parent = dirname(executableDir)
    addCandidate(dirs, join(parent, 'LightTodoData'))
    // Portable builds unpack next to the exe; a new version usually lives in a
    // sibling folder (release/0.6.11 vs release/0.6.10). Scan one level.
    try {
      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        if (entry.isDirectory()) addCandidate(dirs, join(parent, entry.name, 'LightTodoData'))
      }
    } catch {
      /* best effort */
    }
  }

  // Any first-level folder under %APPDATA% that still carries a lighttodo.db.
  try {
    for (const entry of readdirSync(appDataDir, { withFileTypes: true }).slice(0, 200)) {
      if (entry.isDirectory()) addCandidate(dirs, join(appDataDir, entry.name))
    }
  } catch {
    /* best effort */
  }
  return [...dirs]
}

/** Find the newest non-empty 轻单 database outside the current data directory. */
export function findLegacyDatabase(
  currentDir: string,
  appDataDir: string,
  executableDir: string | null
): LegacyCandidate | null {
  const currentPath = join(currentDir, 'lighttodo.db')
  const found: LegacyCandidate[] = []
  for (const dir of candidateDirectories(currentDir, appDataDir, executableDir)) {
    const path = join(dir, 'lighttodo.db')
    if (path === currentPath || !existsSync(path)) continue
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
  return found[0] ?? null
}

/**
 * If the current database is missing/empty, copy the newest legacy database in.
 * The old file is left untouched; the current one (if any) is renamed aside.
 */
export function migrateLegacyDatabase(opts: {
  currentDir: string
  appDataDir: string
  executableDir: string | null
}): MigrationResult {
  const currentPath = join(opts.currentDir, 'lighttodo.db')
  const currentTasks = existsSync(currentPath) ? countTasks(currentPath) : 0
  if (currentTasks > 0) return { migrated: false }

  const legacy = findLegacyDatabase(opts.currentDir, opts.appDataDir, opts.executableDir)
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
