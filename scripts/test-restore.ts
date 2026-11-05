import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { closeDb, createTask, initDb, listTasks } from '../src/main/db.ts'
import {
  removeDatabaseSidecars,
  swapDatabaseFile,
  validateDatabaseFile
} from '../src/main/db-file.ts'

const base = join(process.cwd(), '.tmp', 'qa', 'restore')
rmSync(base, { recursive: true, force: true })
mkdirSync(base, { recursive: true })

function makeDb(dir: string, title: string): void {
  mkdirSync(dir, { recursive: true })
  initDb(dir)
  createTask({ title })
  closeDb()
}

const liveDir = join(base, 'live')
const backupDir = join(base, 'backup')
makeDb(liveDir, '正式库任务')
makeDb(backupDir, '备份库任务')
const goodBackup = join(base, 'good-backup.db')
copyFileSync(join(backupDir, 'lighttodo.db'), goodBackup)

// 1. 正常备份通过完整性、表结构与字段校验。
assert.deepEqual(validateDatabaseFile(goodBackup), { ok: true })

// 2. 空文件、随机内容、缺少业务表的 SQLite 文件都必须被拒绝。
const empty = join(base, 'empty.db')
writeFileSync(empty, '')
const emptyCheck = validateDatabaseFile(empty)
assert.equal(emptyCheck.ok, false)
assert.match(emptyCheck.message, /为空|损坏/)

const garbage = join(base, 'garbage.db')
writeFileSync(garbage, 'this is definitely not a sqlite database')
const garbageCheck = validateDatabaseFile(garbage)
assert.equal(garbageCheck.ok, false)
assert.match(garbageCheck.message, /不是有效的轻单数据库/)

const unrelated = join(base, 'unrelated.db')
const other = new DatabaseSync(unrelated)
other.exec('CREATE TABLE foo (id INTEGER PRIMARY KEY)')
other.close()
const unrelatedCheck = validateDatabaseFile(unrelated)
assert.equal(unrelatedCheck.ok, false)
assert.match(unrelatedCheck.message, /缺少数据表/)

// 3. 校验通过的 staged 文件可以原子替换正式库，替换后读到的是新库数据。
const staged = join(liveDir, 'lighttodo.db.restore-tmp')
copyFileSync(goodBackup, staged)
removeDatabaseSidecars(join(liveDir, 'lighttodo.db'))
const swap = swapDatabaseFile(staged, join(liveDir, 'lighttodo.db'))
initDb(liveDir)
const restoredTitles = listTasks({ view: 'all' }).map((task) => task.title)
assert.ok(restoredTitles.includes('备份库任务'))
swap.commit()
closeDb()

// 4. initDb 失败时可以回滚到旧库，旧任务不丢。
const rollbackDir = join(base, 'rollback')
makeDb(rollbackDir, '回滚前任务')
const stagedRollback = join(rollbackDir, 'lighttodo.db.restore-tmp')
copyFileSync(goodBackup, stagedRollback)
removeDatabaseSidecars(join(rollbackDir, 'lighttodo.db'))
const rollbackSwap = swapDatabaseFile(stagedRollback, join(rollbackDir, 'lighttodo.db'))
rollbackSwap.rollback()
initDb(rollbackDir)
assert.ok(listTasks({ view: 'all' }).some((task) => task.title === '回滚前任务'))
closeDb()

console.log('PASS 备份校验拒绝空/损坏/非轻单数据库')
console.log('PASS 原子替换与回滚保持数据完整')
