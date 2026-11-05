import assert from 'node:assert/strict'
import ts from 'typescript'
const transpile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const asUrl=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64')
import {mkdirSync,readFileSync} from 'node:fs'
mkdirSync('.tmp/qa/review',{recursive:true})
const filterUrl=asUrl(transpile(readFileSync('src/renderer/src/lib/task-filter.ts','utf8')).replace("from 'date-fns'", "from '"+import.meta.resolve('date-fns')+"'"))
const quickAddDateUrl=asUrl(transpile(readFileSync('src/renderer/src/lib/quick-add-date.ts','utf8')))
const storeUrl=asUrl(transpile(readFileSync('src/renderer/src/store.ts','utf8')).replace("from 'zustand'", "from '"+import.meta.resolve('zustand')+"'").replace("from './lib/task-filter'", "from '"+filterUrl+"'").replace("from './lib/quick-add-date'", "from '"+quickAddDateUrl+"'"))
const pending=[]
globalThis.window={api:{tasks:{list:()=>new Promise(resolve=>pending.push(resolve)),get:async(id)=>({id})}}}
const {useStore}=await import(storeUrl)
useStore.setState({tasks:[{id:'high',priority:3},{id:'low',priority:1}],filter:'high'})
useStore.getState().selectAll()
assert.deepEqual(useStore.getState().selectedIds,['high'])
let a=useStore.getState().setView('list',{listId:'A'})
pending.shift()([{id:'A'}]);await a
assert.deepEqual(useStore.getState().selectedIds,[]);assert.equal(useStore.getState().selectMode,false)
a=useStore.getState().setView('today');const b=useStore.getState().setView('all')
pending[1]([{id:'all-task'}]);await b
pending[0]([{id:'today-task'}]);await a
assert.equal(useStore.getState().tasks[0].id,'all-task')
console.log('PASS 筛选全选、跨视图清空选择、乱序响应保护')
useStore.setState({tasks:[{id:'hidden',priority:1}],filter:'high',selectedIds:['hidden']})
await useStore.getState().batchDelete()
console.log('PASS 批量操作不会处理隐藏目标')
const {isOverdue}=await import(filterUrl)
assert.equal(isOverdue({status:0,scheduledDate:'2099-01-01',dueAt:new Date(Date.now()-60000).toISOString()}),true)
assert.equal(isOverdue({status:1,dueAt:'2000-01-01T00:00:00Z'}),false)
console.log('PASS 逾期判定同时检查截止时间与计划日')

// Calendar opening must wait for its visible range rather than requesting all history.
pending.length=0
useStore.setState({view:{type:'today',title:'今天'},calendarRange:null})
await useStore.getState().setView('calendar')
assert.equal(pending.length,0)
a=useStore.getState().setCalendarRange('2026-11-01','2026-11-30')
assert.equal(pending.length,1)
pending.shift()([{id:'calendar-task'}]);await a
await useStore.getState().setView('calendar')
assert.equal(pending.length,0)
assert.equal(useStore.getState().tasks[0].id,'calendar-task')
await useStore.getState().setCalendarRange('2026-11-01','2026-11-30')
assert.equal(pending.length,0)
console.log('PASS 日历首次按范围加载、重复点击不清空重载、同范围不重复查询')

let resolveDetail
window.api.tasks.get=()=>new Promise(resolve=>{resolveDetail=resolve})
useStore.setState({tasks:[{id:'instant',title:'即时详情'}]})
const selection=useStore.getState().selectTask('instant')
assert.equal(useStore.getState().selected.title,'即时详情')
await useStore.getState().selectTask(null)
resolveDetail({id:'instant',title:'迟到详情'});await selection
assert.equal(useStore.getState().selected,null)
console.log('PASS 详情即时显示，关闭后迟到响应不得重新弹出')

// Loading more must not be undone by a concurrent refresh (P0 regression):
// the refresh must keep the reserved 500-row page even if loadMore resolves later.
pending.length = 0
const initial = Array.from({ length: 500 }, (_, i) => ({ id: `seed-${i}` }))
useStore.setState({ view: { type: 'all', title: '全部' }, tasks: initial, loading: false })
const morePromise = useStore.getState().loadMore()
const refreshPromise = useStore.getState().refresh()
const refreshed = Array.from({ length: 1000 }, (_, i) => ({ id: `full-${i}` }))
pending[1](refreshed)
await refreshPromise
pending[0](Array.from({ length: 500 }, (_, i) => ({ id: `more-${i}` })))
await morePromise
assert.equal(useStore.getState().tasks.length, 1000)
assert.equal(useStore.getState().tasks[0].id, 'full-0')
console.log('PASS 加载更多与并发刷新不会回退列表')

// Undo: completion, deletion and drag moves must be reversible without a full reload race.
window.api.tasks.list = async () => []
window.api.sidebar = { get: async () => ({ folders: [], lists: [], tags: [], counts: {} }) }
const calls = []
window.api.tasks.setStatus = async (id, done) => { calls.push(['status', id, done]); return { id, status: done ? 1 : 0 } }
window.api.tasks.remove = async (id) => { calls.push(['remove', id]) }
window.api.tasks.restore = async (id) => { calls.push(['restore', id]) }
window.api.tasks.reorder = async (items) => { calls.push(['reorder', items]) }
window.api.tasks.update = async (id, patch) => { calls.push(['update', id, patch]); return { id, title: 'Undo', status: 0, ...patch } }
window.api.tasks.get = async (id) => ({ id, title: 'Undo', status: calls.at(-1)?.[2] ? 1 : 0 })

useStore.setState({
  view: { type: 'all', title: '全部' },
  tasks: [{ id: 'undo', title: 'Undo', status: 0, priority: 0, sortOrder: 1024, tags: [], subtaskCount: 0, subtaskDone: 0 }],
  selected: null,
  undoLabel: ''
})
await useStore.getState().toggleTask('undo')
assert.equal(useStore.getState().undoLabel, '完成「Undo」')
await useStore.getState().undo()
assert.deepEqual(calls.slice(-2), [['status', 'undo', true], ['status', 'undo', false]])

calls.length = 0
useStore.setState({ tasks: [{ id: 'undo', title: 'Undo', status: 0, priority: 0, sortOrder: 1024, tags: [], subtaskCount: 0, subtaskDone: 0 }], undoLabel: '' })
await useStore.getState().deleteTask('undo')
assert.equal(useStore.getState().undoLabel, '删除「Undo」')
await useStore.getState().undo()
assert.deepEqual(calls, [['remove', 'undo'], ['restore', 'undo']])

calls.length = 0
useStore.setState({
  tasks: [
    { id: 'a', title: 'A', status: 0, priority: 0, sortOrder: 1024, tags: [], subtaskCount: 0, subtaskDone: 0 },
    { id: 'b', title: 'B', status: 0, priority: 0, sortOrder: 2048, tags: [], subtaskCount: 0, subtaskDone: 0 },
    { id: 'c', title: 'C', status: 0, priority: 0, sortOrder: 3072, tags: [], subtaskCount: 0, subtaskDone: 0 }
  ],
  undoLabel: ''
})
await useStore.getState().moveTask('c', 'b')
const moved = calls[0][1][0]
assert.equal(moved.id, 'c')
assert.equal(moved.sortOrder, 1536)
await useStore.getState().undo()
assert.equal(calls[1][1][0].sortOrder, 3072)
console.log('PASS 撤销覆盖完成/删除/拖动排序')
