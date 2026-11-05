const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync(require('node:path').join(process.cwd(), '.tmp', 'qa', 'perf', 'lighttodo.db'))
console.log('tasks', db.prepare('SELECT COUNT(*) c FROM tasks').get().c)
console.log('today', db.prepare("SELECT COUNT(*) c FROM tasks WHERE status=0 AND deleted_at IS NULL AND scheduled_date IS NOT NULL").get().c)
