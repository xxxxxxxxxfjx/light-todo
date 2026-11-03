import { initDb, getSidebar, listTasks } from '../src/main/db.ts'

const dir = 'E:/code/todo/.qa-perf'
initDb(dir)

function t(name: string, fn: () => unknown): void {
  const s = performance.now()
  const r = fn()
  const n = Array.isArray(r) ? r.length : ''
  console.log(name, `${(performance.now() - s).toFixed(1)}ms`, n)
}

t('sidebar', () => getSidebar())
t('sidebar x5', () => { for (let i = 0; i < 5; i++) getSidebar() })
t('today', () => listTasks({ view: 'today' }))
t('all(1000)', () => listTasks({ view: 'all', limit: 1000 }))
t('all(5000)', () => listTasks({ view: 'all', limit: 5000 }))
t('upcoming', () => listTasks({ view: 'upcoming' }))
t('today x10', () => { for (let i = 0; i < 10; i++) listTasks({ view: 'today' }) })
