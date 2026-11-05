// Native launcher regression: exercises the embedded ZIP, not a loose runtime.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')
const assert = require('node:assert/strict')
const root = path.resolve('.tmp/e2e')
fs.mkdirSync(root, { recursive: true })
const dir = fs.mkdtempSync(path.join(root, 'payload-'))
const appDir = path.join(dir, 'payload')
fs.mkdirSync(path.join(appDir, 'resources'), { recursive: true })
fs.writeFileSync(path.join(appDir, 'resources', 'app.asar'), 'fixture')
const csc = path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
const stub = path.join(dir, 'Stub.cs')
fs.writeFileSync(stub, `using System;using System.IO;class Stub{static int Main(string[] args){
if(Environment.GetEnvironmentVariable("ELECTRON_RUN_AS_NODE")!=null || Environment.GetEnvironmentVariable("NODE_OPTIONS")!=null)return 9;
var root=Environment.GetEnvironmentVariable("PORTABLE_EXECUTABLE_DIR");
File.WriteAllText(Path.Combine(root,"ok-"+args[0]),Environment.GetEnvironmentVariable("PORTABLE_EXECUTABLE_FILE"));return 0;}}`)
execFileSync(csc, ['/nologo', '/target:winexe', `/out:${path.join(appDir, 'LightTodoRuntime.exe')}`, stub])
const payload = path.join(dir, 'payload.zip')
const q = s => "'" + s.replaceAll("'", "''") + "'"
execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory(${q(appDir)},${q(payload)})`])
const launcher = path.join(dir, 'Launcher.cs')
fs.writeFileSync(launcher, fs.readFileSync('scripts/LightTodoLauncher.cs', 'utf8').replaceAll('__LIGHTTODO_VERSION__', 'test'))
const exe = path.join(dir, 'LightTodo.exe')
execFileSync(csc, ['/nologo', '/target:winexe', '/platform:x64', '/reference:System.Windows.Forms.dll', '/reference:System.IO.Compression.dll', `/resource:${payload},LightTodo.Payload.fixture.zip`, `/out:${exe}`, launcher])
const env = { ...process.env }
for (const key of Object.keys(env)) if (/^(LIGHTTODO_DATA_DIR|PORTABLE_EXECUTABLE_DIR|PORTABLE_EXECUTABLE_FILE)$/i.test(key)) delete env[key]
env.ELECTRON_RUN_AS_NODE = '1'
env.NODE_OPTIONS = '--invalid-test-option'
function run(id) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, [id], { env, stdio: 'ignore', windowsHide: true })
    const timer = setTimeout(() => { child.kill(); reject(Error('Embedded launcher timed out')) }, 15000)
    child.on('error', reject)
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error('Launcher exit ' + code)) })
  })
}
;(async () => {
  await Promise.all([run('first'), run('concurrent')])
  for (const name of ['first', 'concurrent']) assert.equal(fs.readFileSync(path.join(dir, 'ok-' + name), 'utf8'), exe)
  console.log('PASS 嵌入 ZIP 首次/并发启动、环境清理、保留外层 exe 路径')
  const cache = path.join(dir, 'LightTodoApp-test-fixture')
  fs.unlinkSync(path.join(cache, 'LightTodoRuntime.exe'))
  await run('repair-runtime')
  assert.ok(fs.existsSync(path.join(cache, 'LightTodoRuntime.exe')))
  fs.unlinkSync(path.join(cache, '.complete'))
  fs.writeFileSync(path.join(cache, 'resources', 'app.asar'), 'interrupted')
  await run('repair-interrupted')
  assert.equal(fs.readFileSync(path.join(cache, 'resources', 'app.asar'), 'utf8'), 'fixture')
  console.log('PASS 缺失运行时及中断解压自动修复，不要求用户重命名目录')
})().catch(error => { console.error(error); process.exitCode = 1 })
