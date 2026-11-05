import { DatabaseSync } from 'node:sqlite'
import { existsSync, renameSync, rmSync, statSync } from 'node:fs'

/**
 * 备份恢复前的文件级校验与替换。这里刻意不依赖 Electron，
 * 以便在 Node 逻辑回归里直接验证“坏备份不会覆盖正式库”。
 */

export type DatabaseValidation =
  | { ok: true }
  | { ok: false; message: string }

const REQUIRED_TABLES = ['tasks', 'lists', 'folders', 'tags', 'settings'] as const
const REQUIRED_TASK_COLUMNS = ['id', 'title', 'status', 'created_at', 'updated_at'] as const

/** 检查一个文件是否是完整、可读的轻单数据库。 */
export function validateDatabaseFile(path: string): DatabaseValidation {
  let size = 0
  try {
    size = statSync(path).size
  } catch {
    return { ok: false, message: '备份文件不存在' }
  }
  if (size === 0) return { ok: false, message: '备份文件为空或已损坏' }

  let db: DatabaseSync | null = null
  try {
    // 只读打开，避免校验过程本身修改备份。
    db = new DatabaseSync(path, { readOnly: true })
    const integrity = db.prepare('PRAGMA integrity_check').all() as Array<Record<string, unknown>>
    const status = String(integrity[0]?.integrity_check ?? '')
    if (status !== 'ok') {
      return { ok: false, message: '备份数据库完整性检查未通过' }
    }
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
        .map((row) => row.name)
    )
    const missingTables = REQUIRED_TABLES.filter((table) => !tables.has(table))
    if (missingTables.length) {
      return { ok: false, message: `备份数据库缺少数据表：${missingTables.join('、')}` }
    }
    const columns = new Set(
      (db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>).map((row) => row.name)
    )
    const missingColumns = REQUIRED_TASK_COLUMNS.filter((column) => !columns.has(column))
    if (missingColumns.length) {
      return { ok: false, message: `备份数据库缺少字段：${missingColumns.join('、')}` }
    }
    db.prepare('SELECT COUNT(*) AS count FROM tasks').get()
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      message: `不是有效的轻单数据库：${error instanceof Error ? error.message : String(error)}`
    }
  } finally {
    try {
      db?.close()
    } catch {
      /* 校验失败时关闭异常不覆盖原始错误 */
    }
  }
}

export interface DatabaseSwap {
  /** 删除回滚副本，确认新库已经可以正常打开。 */
  commit(): void
  /** 还原旧库，用于 initDb 或迁移失败时回滚。 */
  rollback(): void
}

/**
 * 用 staged 文件原子替换正式库：先把旧库改名保留，再改名 staged。
 * 同一文件系统内 rename 是原子的，避免 copyFile 中途失败留下半个库。
 */
export function swapDatabaseFile(stagedPath: string, destPath: string): DatabaseSwap {
  const saved = `${destPath}.pre-restore`
  if (existsSync(saved)) rmSync(saved, { force: true })
  const hadExisting = existsSync(destPath)
  if (hadExisting) renameSync(destPath, saved)
  try {
    renameSync(stagedPath, destPath)
  } catch (error) {
    if (hadExisting && existsSync(saved) && !existsSync(destPath)) renameSync(saved, destPath)
    throw error
  }

  let settled = false
  return {
    commit(): void {
      if (settled) return
      settled = true
      try {
        if (existsSync(saved)) rmSync(saved, { force: true })
      } catch {
        /* 回滚副本清理失败不影响已经恢复成功的正式库 */
      }
    },
    rollback(): void {
      if (settled) return
      settled = true
      try {
        if (existsSync(destPath)) rmSync(destPath, { force: true })
      } catch {
        /* 下面会再次尝试让旧库回到原位 */
      }
      if (hadExisting && existsSync(saved)) renameSync(saved, destPath)
    }
  }
}

/** 删除 SQLite 的 WAL/SHM 旁路文件，供换库前清理。 */
export function removeDatabaseSidecars(dbPath: string): void {
  for (const suffix of ['-wal', '-shm']) {
    try {
      rmSync(dbPath + suffix, { force: true })
    } catch {
      /* SQLite 关闭后通常已经清理；删不掉时交给下次打开处理 */
    }
  }
}
