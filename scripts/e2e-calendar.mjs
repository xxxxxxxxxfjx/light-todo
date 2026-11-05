import {spawn} from 'node:child_process'
import {mkdtempSync,writeFileSync,readFileSync,existsSync,mkdirSync} from 'node:fs'
import {join,resolve} from 'node:path'
import assert from 'node:assert/strict'
mkdirSync(join(process.cwd(),'.tmp','e2e'),{recursive:true})
const dir=mkdtempSync(join(process.cwd(),'.tmp','e2e','calendar-release-'))
mkdirSync(join(process.cwd(),'.tmp','shots'),{recursive:true})
const packaged=process.argv[2]
const exe=packaged ? resolve(packaged) : resolve('node_modules/electron/dist/electron.exe')
const spec=join(dir,'calendar.json')
const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1)
const date=`${tomorrow.getFullYear()}-${String(tomorrow.getMonth()+1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`
const setText=(text)=>`(()=>{const i=document.querySelector('.qa-input');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(i,${JSON.stringify(text)});i.dispatchEvent(new Event('input',{bubbles:true}))})()`
const steps=[
 {js:`[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.includes('日历')).click()`,wait:500},
 {js:`document.querySelector('[data-date="${date}"]').click()`,wait:250},
 {js:`({overlay:!!document.querySelector('.qa'),selected:document.querySelector('.selected-day')?.dataset.date,agenda:document.querySelector('.agenda-head').textContent})`},
 {js:`document.querySelector('.agenda-head .primary-btn').click()`,wait:200},
 {js:setText('日历交互回归任务'),wait:200},
 {js:`document.querySelector('.qa-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}))`,wait:200},
 {js:`!!document.querySelector('.qa')`},
 {js:`document.querySelector('.qa-submit').click()`,wait:500},
 {js:`({title:document.querySelector('.agenda-list').textContent,chip:!!document.querySelector('[data-date="${date}"] .cal-item')})`},
 {shot:resolve('.tmp/shots/calendar-0.2.0.png')},
 {js:`document.querySelector('.agenda-task').click()`,wait:300},
 {js:`({title:document.querySelector('.detail-title')?.value,width:document.querySelector('.cal-cell')?.getBoundingClientRect().width})`},
 {js:`document.querySelector('.detail-head button').click()`,wait:200},
 {js:`document.querySelectorAll('.calendar-modes button')[1].click()`,wait:200},
 {js:`document.querySelectorAll('.week-column').length`},
 {js:`document.querySelectorAll('.calendar-modes button')[2].click()`,wait:200},
 {js:`({day:!!document.querySelector('.calendar-day'),rows:document.querySelectorAll('.agenda-row').length})`},
 {js:`document.querySelector('.agenda-row .check').click()`,wait:400},
 {js:`document.querySelectorAll('.agenda-row').length`},
 {js:`document.querySelector('.calendar-subbar input').click()`,wait:200},
 {js:`document.querySelectorAll('.agenda-row.done').length`},
 {js:`document.querySelector('.agenda-row .check').click()`,wait:400},
 {js:`document.querySelectorAll('.agenda-row:not(.done)').length`}
]
writeFileSync(spec,JSON.stringify({steps}))
const env={...process.env,LIGHTTODO_DATA_DIR:dir}
if(packaged){env.ELECTRON_RUN_AS_NODE='1';env.NODE_OPTIONS='--invalid-option-for-qa'}else{delete env.ELECTRON_RUN_AS_NODE}
const extra=(process.env.QA_LAUNCH_FLAGS ?? '').split(' ').filter(Boolean)
const child=spawn(exe,[...(packaged?[]:['.']),...extra,`--e2e=${spec}`],{env,cwd:process.cwd(),stdio:['ignore','pipe','pipe']})
let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d)
try{
 await new Promise((ok,fail)=>{const timer=setTimeout(()=>{child.kill();fail(new Error('45秒启动或交互超时'))},45000);child.on('exit',(code)=>{logs+='\nEXIT '+code;clearTimeout(timer);ok()});child.on('error',e=>{clearTimeout(timer);fail(e)})})
 const output=spec.replace('.json','.out.json');assert.ok(existsSync(output),logs)
 const out=JSON.parse(readFileSync(output,'utf8'));assert.equal(out.ok,true,out.error);const r=out.results
 assert.equal(r[2].overlay,false);assert.equal(r[2].selected,date)
 assert.equal(r[6],true,'输入法合成回车不能提交')
 assert.ok(r[8].title.includes('日历交互回归任务'));assert.equal(r[8].chip,true)
 assert.equal(r[11].title,'日历交互回归任务');assert.ok(r[11].width>40)
 assert.equal(r[14],7);assert.equal(r[16].day,true);assert.equal(r[16].rows,1)
 assert.equal(r[18],0);assert.equal(r[20],1);assert.equal(r[22],1)
 console.log('PASS 日历选择、指定日期添加、中文输入法、详情、周/日视图、完成与撤销')
 console.log('PASS 启动，外部参数：'+(extra.join(' ') || '无')+(packaged ? '；已验证忽略Electron/Node环境变量' : ''))
 console.log('Data:',dir)
}catch(e){console.error(logs);throw e}
