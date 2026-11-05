import {spawn,execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,copyFileSync,cpSync,statSync,existsSync,readFileSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import assert from 'node:assert/strict'
mkdirSync(join(process.cwd(),'.tmp','e2e'),{recursive:true})
const dir=mkdtempSync(join(process.cwd(),'.tmp','e2e','default-launch-'))
const source=resolve(process.argv[2]);const exe=join(dir,'LightTodo.exe');
if(statSync(source).isDirectory()) cpSync(source,dir,{recursive:true});else copyFileSync(source,exe)
const shot=join(dir,'calendar.png')
const env={...process.env};for(const key of Object.keys(env))if(/^(LIGHTTODO_DATA_DIR|PORTABLE_EXECUTABLE_DIR|PORTABLE_EXECUTABLE_FILE|ELECTRON_RUN_AS_NODE|NODE_OPTIONS)$/i.test(key))delete env[key]
// First exercise exactly what double-click does: no arguments and no overrides.
const plain=spawn(exe,[],{env,cwd:dir,stdio:'ignore'})
const startup=join(dir,'LightTodoData','userdata','startup.log')
try {
 const deadline=Date.now()+60000
 while(!existsSync(startup)||!readFileSync(startup,'utf8').includes('Window ready')) {
  if(plain.exitCode!==null) throw Error('无参数启动提前退出：'+plain.exitCode)
  if(Date.now()>deadline) throw Error('无参数启动未出现窗口就绪日志')
  await new Promise(resolve=>setTimeout(resolve,100))
 }
 assert.equal(plain.exitCode,null,'窗口就绪后进程已退出')
 console.log('PASS 无参数双击等价启动：窗口已就绪，进程保持运行')
} finally {
 if(plain.exitCode===null) execFileSync('taskkill',['/PID',String(plain.pid),'/T','/F'],{stdio:'ignore'})
 await new Promise(resolve=>{if(plain.exitCode!==null)resolve();else plain.once('exit',resolve)})
}
const child=spawn(exe,[`--screenshot=${shot}`,'--qa=calendar'],{env,cwd:resolve('.'),stdio:'ignore'})
await new Promise((ok,fail)=>{const timer=setTimeout(()=>{child.kill();fail(new Error('默认启动路径超时'))},60000);child.on('exit',code=>{clearTimeout(timer);code===0?ok():fail(new Error('退出码 '+code))});child.on('error',e=>{clearTimeout(timer);fail(e)})})
assert.ok(existsSync(shot),'没有生成日历截图')
const dbFile=join(dir,'LightTodoData','lighttodo.db');assert.ok(existsSync(dbFile),'没有使用exe旁的默认便携数据目录')
const db=new DatabaseSync(dbFile,{readOnly:true});assert.ok(db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n>=3);db.close()
const log=join(dir,'LightTodoData','launcher.log');assert.ok(existsSync(log));assert.match(readFileSync(log,'utf8'),/exit(?:-retry)?=0/)
const result={exe,shot,data:dbFile,log};writeFileSync(join(dir,'verification.json'),JSON.stringify(result,null,2));console.log('PASS 单文件exe默认启动：未设置数据目录和便携目录环境变量');console.log('PASS 日历截图、SQLite任务及本地日志均存在');console.log(JSON.stringify(result))
