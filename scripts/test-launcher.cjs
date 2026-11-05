const fs=require('node:fs'),path=require('node:path'),{execFileSync,spawn}=require('node:child_process'),assert=require('node:assert/strict');
fs.mkdirSync(path.join(process.cwd(),'.tmp','e2e'),{recursive:true});
const base=fs.mkdtempSync(path.join(process.cwd(),'.tmp','e2e','launcher-'));
const csc=path.join(process.env.WINDIR||'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const launcher=path.join(base,'Launcher.cs');fs.writeFileSync(launcher,fs.readFileSync('scripts/LightTodoLauncher.cs','utf8').replaceAll('__LIGHTTODO_VERSION__','test'));
const stub=path.join(base,'Runtime.cs');fs.writeFileSync(stub,`using System;using System.IO;using System.Diagnostics;using System.Threading;class Stub {
 static int Main(string[] args){var root=AppDomain.CurrentDomain.BaseDirectory;var mode=args.Length==0?"normal":args[0];File.AppendAllText(Path.Combine(root,"runtime-calls.txt"),"run:"+String.Join("|",args)+"\\n");File.WriteAllText(Path.Combine(root,"portable-root.txt"),Environment.GetEnvironmentVariable("PORTABLE_EXECUTABLE_DIR")??"missing");
 if(mode=="--retry-test")return unchecked((int)0x80000003);
 if(mode=="--grandchild"){File.WriteAllText(Path.Combine(root,"grandchild.pid"),Process.GetCurrentProcess().Id.ToString());Thread.Sleep(Timeout.Infinite);}
 if(mode=="--hang"){File.WriteAllText(Path.Combine(root,"runtime.pid"),Process.GetCurrentProcess().Id.ToString());var info=new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,"--grandchild");info.UseShellExecute=false;info.CreateNoWindow=true;Process.Start(info);Thread.Sleep(Timeout.Infinite);}
 return 0;
 }} `);
execFileSync(csc,['/nologo','/target:winexe',`/out:${path.join(base,'LightTodoRuntime.exe')}`,stub]);
execFileSync(csc,['/nologo','/target:winexe','/platform:x64','/reference:System.Windows.Forms.dll','/reference:System.IO.Compression.dll',`/out:${path.join(base,'LightTodo.exe')}`,launcher]);
const cleanEnv=()=>{const env={...process.env};for(const key of Object.keys(env))if(/^(LIGHTTODO_DATA_DIR|PORTABLE_EXECUTABLE_DIR|ELECTRON_RUN_AS_NODE|NODE_OPTIONS)$/i.test(key))delete env[key];return env};
const launch=(env,args=[])=>spawn(path.join(base,'LightTodo.exe'),args,{env,stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(check,message)=>{const deadline=Date.now()+10000;while(!check()){if(Date.now()>deadline)throw Error(message);await sleep(100)}};
const alive=pid=>{try{process.kill(pid,0);return true}catch{return false}};
async function run(env,args=[],expected=0){const child=launch(env,args);return new Promise((ok,fail)=>{const timer=setTimeout(()=>{child.kill();fail(new Error('Launcher timed out'))},12000);child.once('exit',code=>{clearTimeout(timer);try{assert.equal(code>>>0,expected>>>0);ok()}catch(e){fail(e)}});child.once('error',fail)})}
async function killTest(target){
 for(const name of ['runtime.pid','grandchild.pid'])fs.rmSync(path.join(base,name),{force:true});
 const child=launch(cleanEnv(),['--hang']);const exited=new Promise(resolve=>child.once('exit',resolve));
 const recorded=[];
 try {
  await until(()=>fs.existsSync(path.join(base,'grandchild.pid')),'Descendant did not start');
  const runtime=Number(fs.readFileSync(path.join(base,'runtime.pid'),'utf8')),grandchild=Number(fs.readFileSync(path.join(base,'grandchild.pid'),'utf8'));recorded.push(runtime,grandchild);
  process.kill(target==='launcher'?child.pid:runtime);
  await until(()=>!alive(runtime)&&!alive(grandchild),'Orphan child survived '+target+' termination');
  await Promise.race([exited,sleep(5000).then(()=>{throw Error('Launcher did not exit')})]);
  const before=fs.readFileSync(path.join(base,'runtime-calls.txt'),'utf8');await sleep(700);assert.equal(fs.readFileSync(path.join(base,'runtime-calls.txt'),'utf8'),before,'Runtime restarted after kill');
  console.log('PASS 强制结束'+target+'：运行时及孙进程一起退出，无重启');
 } finally {if(alive(child.pid))child.kill();for(const pid of recorded)if(alive(pid))process.kill(pid)}
}
(async()=>{
 await run(cleanEnv());assert.ok(fs.existsSync(path.join(base,'LightTodoData','launcher.log')));assert.equal(path.resolve(fs.readFileSync(path.join(base,'portable-root.txt'),'utf8')),path.resolve(base));console.log('PASS 默认便携目录启动');
 const blocked=path.join(base,'blocked-log');fs.writeFileSync(blocked,'not a directory');const env=cleanEnv();env.LIGHTTODO_DATA_DIR=blocked;
 await run(env);console.log('PASS 日志不可写仍可正常启动');
 const before=fs.readFileSync(path.join(base,'runtime-calls.txt'),'utf8').trim().split('\n').length;
 await run(cleanEnv(),['--retry-test'],0x80000003);const calls=fs.readFileSync(path.join(base,'runtime-calls.txt'),'utf8').trim().split('\n');assert.equal(calls.length,before+1);assert.equal(calls.at(-1),'run:--retry-test');console.log('PASS 异常退出只启动一次，不做兼容重试');
 const outer=path.join(base,'outer');fs.mkdirSync(outer);const inherited=cleanEnv();inherited.PORTABLE_EXECUTABLE_DIR=outer;await run(inherited);assert.ok(fs.existsSync(path.join(outer,'LightTodoData','launcher.log')));console.log('PASS 子启动器沿用外层便携目录');
 await killTest('launcher');await killTest('runtime');
 console.log('Launcher lifecycle tests passed:',base);
})().catch(e=>{console.error(e);process.exitCode=1});
