const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync('E:/code/todo/.qa-perf/lighttodo.db')
console.log('tasks', db.prepare('SELECT COUNT(*) c FROM tasks').get().c)
console.log('today', db.prepare("SELECT COUNT(*) c FROM tasks WHERE status=0 AND deleted_at IS NULL AND scheduled_date IS NOT NULL").get().c)
