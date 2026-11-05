import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import * as db from '../src/main/db.ts'
import { importFromText } from '../src/main/import.ts'
import { format } from 'date-fns'
mkdirSync(join(process.cwd(),'.tmp','qa'),{recursive:true})
const dir=mkdtempSync(join(process.cwd(),'.tmp','qa','regressions-'))
db.initDb(dir)
try {
 const list=db.createList({name:'回归清单'})
 const parent=db.createTask({title:'往返任务',listId:list.id,scheduledDate:'2026-11-03',rrule:'FREQ=DAILY',reminderOffset:5,notes:'父备注',tagNames:['往返标签']})
 const sub=db.createTask({title:'往返子任务',parentId:parent.id,notes:'子备注'})
 // 收件箱生命周期：无清单无日期 -> inbox；安排今天后 -> today；也许 -> 永不进 inbox。
 const inboxTask=db.createTask({title:'收件箱生命周期'})
 assert.ok(db.listTasks({view:'inbox'}).some(t=>t.id===inboxTask.id))
 assert.ok(!db.listTasks({view:'today'}).some(t=>t.id===inboxTask.id))
 assert.equal(db.getSidebar().counts.inbox,1)
 db.updateTask(inboxTask.id,{scheduledDate:format(new Date(),'yyyy-MM-dd')})
 assert.ok(!db.listTasks({view:'inbox'}).some(t=>t.id===inboxTask.id))
 assert.ok(db.listTasks({view:'today'}).some(t=>t.id===inboxTask.id))
 const maybeTask=db.createTask({title:'也许不进收件箱',someday:true})
 assert.ok(!db.listTasks({view:'inbox'}).some(t=>t.id===maybeTask.id))
 assert.equal(db.getSidebar().counts.inbox,0)
 console.log('PASS 收件箱生命周期与今天隔离')
 db.setTaskStatus(parent.id,true)
 const json=db.getAllData(); const before=db.searchTasks('往返任务').map(t=>t.id)
 assert.equal(importFromText(JSON.stringify(json),'backup.json').ok,true)
 const imported=db.searchTasks('往返任务').filter(t=>!before.includes(t.id))
 assert.equal(imported.length,2)
 const done=imported.find(t=>t.status===1)!
 assert.equal(done.listId,list.id);assert.equal(done.rrule,'FREQ=DAILY');assert.equal(done.reminderOffset,5)
 assert.equal(db.getTask(done.id)?.subtasks?.[0].notes,'子备注')
 const n=db.searchTasks('往返任务').length
 db.setTaskStatus(done.id,false);db.setTaskStatus(done.id,true)
 assert.equal(db.searchTasks('往返任务').length,n,'导入后重复链也应幂等')
 console.log('PASS JSON完整往返、父子关系和重复链')
 const repeat=db.createTask({title:'重复幂等',scheduledDate:'2026-11-03',rrule:'FREQ=DAILY'})
 db.setTaskStatus(repeat.id,true);db.setTaskStatus(repeat.id,false);db.setTaskStatus(repeat.id,true)
 assert.equal(db.searchTasks('重复幂等').filter(t=>t.status===0).length,1)
 db.closeDb();db.initDb(dir);db.setTaskStatus(repeat.id,false);db.setTaskStatus(repeat.id,true)
 assert.equal(db.searchTasks('重复幂等').length,2)
 console.log('PASS 重复任务撤销和跨重启幂等')
 const rem=db.createTask({title:'提醒恢复',dueAt:'2026-11-04T01:00:00.000Z',reminderOffset:5})
 db.setTaskStatus(rem.id,true);db.setTaskStatus(rem.id,false)
 assert.equal(db.getTask(rem.id)?.reminderAt,rem.reminderAt)
 assert.equal(db.getTask(rem.id)?.notifiedAt,null)
 db.updateTask(parent.id,{listId:null});assert.equal(db.getTask(sub.id)?.listId,null)
 console.log('PASS 提醒恢复、移动父子任务')
 const lists=db.getLists().length
 let bad=importFromText(JSON.stringify({lists:[{name:'应该回滚'}],tasks:[{id:'bad',title:'应该回滚任务',parentId:'missing'}]}),'bad.json')
 assert.equal(bad.ok,false);assert.equal(db.getLists().length,lists);assert.equal(db.searchTasks('应该回滚任务').length,0)
 bad=importFromText(JSON.stringify({tasks:[{title:'部分写入'},{title:null}]}),'bad.json')
 assert.equal(bad.ok,false);assert.equal(db.searchTasks('部分写入').length,0)
 console.log('PASS 导入校验及事务回滚')
 const csv=importFromText('标题,完成状态\n状态未完成,未完成\n状态已完成,已完成\n','ticktick.csv')
 assert.equal(csv.tasks,2);assert.equal(db.searchTasks('状态未完成')[0].status,0);assert.equal(db.searchTasks('状态已完成')[0].status,1)
 const td=importFromText('TYPE,CONTENT,PRIORITY,INDENT\nsection,章节记录,4,1\nnote,备注记录,4,1\ntask,有效任务,4,1\ntask,有效子任务,4,2\n','todoist.csv')
 assert.equal(td.tasks,2);assert.equal(db.searchTasks('章节记录').length,0);assert.ok(db.searchTasks('有效子任务')[0].parentId)
 console.log('PASS CSV状态及Todoist类型')
 const baseline=db.listTasks({view:'all',limit:-1}).length
 db.transaction(()=>{for(let i=0;i<1100;i++) db.createTask({title:`分页任务${i}`})})
 const first=db.listTasks({view:'all',limit:1000}); const second=db.listTasks({view:'all',limit:1000,offset:1000})
 assert.equal(first.length+second.length,baseline+1100);assert.equal(new Set([...first,...second].map(t=>t.id)).size,baseline+1100)
 console.log('PASS 大于1000条记录分页无遗漏无重复')
} finally { db.closeDb() }
