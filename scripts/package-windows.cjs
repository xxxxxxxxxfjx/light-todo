const {build,Platform}=require('electron-builder')
const {execFileSync,execSync}=require('node:child_process')
const {readFileSync,writeFileSync,renameSync,existsSync,mkdirSync}=require('node:fs')
const crypto=require('node:crypto')
const path=require('node:path')
const root=path.resolve(__dirname,'..')
const pkg=require('../package.json')
const output=path.join(root,'release',pkg.version)
const appOut=path.join(output,'win-unpacked')
async function main(){
  // Release checks live here so every caller/model goes through the same gate.
  // Never overwrite a released version, even when --reuse is supplied.
  if(existsSync(path.join(output,'checksums.json'))) throw Error('此版本已经发布，请先递增 package.json 的 patch 版本')
  const checkEnv={...process.env,PATH:path.join(root,'node_modules','.bin')+path.delimiter+process.env.PATH}
  const skipE2E=process.env.LIGHTTODO_SKIP_E2E==='1'
  for(const name of ['typecheck','test:unit','test:launcher']) {
    console.log('Release gate:',name)
    execSync(pkg.scripts[name],{cwd:root,stdio:'inherit',env:checkEnv})
  }
  mkdirSync(output,{recursive:true})
  const launcherSource=path.join(output,'LightTodoLauncher.cs')
  writeFileSync(launcherSource,readFileSync(path.join(root,'scripts/LightTodoLauncher.cs'),'utf8').replaceAll('__LIGHTTODO_VERSION__',pkg.version))
  if(!process.argv.includes('--reuse')) {
    execFileSync(process.execPath,[path.join(root,'node_modules/electron-vite/bin/electron-vite.js'),'build'],{cwd:root,stdio:'inherit'})
    await build({targets:Platform.WINDOWS.createTarget('dir'),config:{directories:{output},electronDist:path.join(root,'node_modules/electron/dist')}})
  }
  if(!skipE2E) execSync(pkg.scripts['test:e2e'],{cwd:root,stdio:'inherit',env:checkEnv})
  const runtime=path.join(appOut,'LightTodoRuntime.exe')
  if(!existsSync(runtime)) renameSync(path.join(appOut,'LightTodo.exe'),runtime)
  const png=readFileSync(path.join(root,'build/icon.png'))
  const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18)
  const ico=path.join(root,'build/icon.ico');writeFileSync(ico,Buffer.concat([header,png]))
  const csc=path.join(process.env.WINDIR ?? 'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe')
  execFileSync(csc,['/nologo','/target:winexe','/platform:x64','/reference:System.Windows.Forms.dll','/reference:System.IO.Compression.dll',`/win32icon:${ico}`,`/out:${path.join(appOut,'LightTodo.exe')}`,launcherSource],{cwd:root,stdio:'inherit'})
  const payload=path.join(output,`LightTodo-${pkg.version}-portable.zip`)
  if(existsSync(payload)) require('node:fs').unlinkSync(payload)
  const quote=s=>"'"+s.replaceAll("'","''")+"'"
  execFileSync('powershell.exe',['-NoProfile','-Command',`Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory(${quote(appOut)}, ${quote(payload)}, [System.IO.Compression.CompressionLevel]::Optimal, $false)`],{cwd:root,stdio:'inherit'})
  const payloadHash=require('node:crypto').createHash('sha256').update(readFileSync(payload)).digest('hex').slice(0,12)
  execFileSync(csc,['/nologo','/target:winexe','/platform:x64','/reference:System.Windows.Forms.dll','/reference:System.IO.Compression.dll',`/win32icon:${ico}`,`/resource:${payload},LightTodo.Payload.${payloadHash}.zip`,`/out:${path.join(output,`LightTodo-${pkg.version}-x64.exe`)}`,launcherSource],{cwd:root,stdio:'inherit'})
  // Exercise the actual embedded payload and ZIP launcher with no data-dir override.
  execFileSync(process.execPath,[path.join(root,'scripts/test-default-launch.mjs'),path.join(output,`LightTodo-${pkg.version}-x64.exe`)],{cwd:root,stdio:'inherit'})
  const zipSmoke=path.join(root,'.tmp','e2e','zip-release-'+Date.now())
  execFileSync('powershell.exe',['-NoProfile','-Command',`Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory(${quote(payload)}, ${quote(zipSmoke)})`],{cwd:root,stdio:'inherit'})
  execFileSync(process.execPath,[path.join(root,'scripts/test-default-launch.mjs'),zipSmoke],{cwd:root,stdio:'inherit'})
  const artifacts=[
    path.join(output,`LightTodo-${pkg.version}-x64.exe`),
    payload
  ].map(file=>{
    const data=readFileSync(file)
    return {
      name:path.basename(file),
      bytes:data.length,
      sha256:crypto.createHash('sha256').update(data).digest('hex')
    }
  })
  writeFileSync(path.join(output,'checksums.json'),JSON.stringify({verifiedBuildFiles:artifacts.length,checks:['typecheck','test:unit','test:launcher',...(skipE2E?[]:['test:e2e']),'single-exe-launch','zip-launch'],files:artifacts},null,2)+'\n')
  console.log('READY',path.join(output,`LightTodo-${pkg.version}-x64.exe`))
}
main().catch(e=>{console.error(e);process.exitCode=1})
