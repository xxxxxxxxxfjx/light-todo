const { build, Platform } = require('electron-builder')
const { execFileSync, execSync } = require('node:child_process')
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const crypto = require('node:crypto')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const pkg = require('../package.json')
const output = path.join(root, 'release', `mac-${pkg.version}`)
const appPath = path.join(output, 'mac-arm64', 'LightTodo.app')

async function main() {
  if (existsSync(path.join(output, 'checksums.json'))) {
    throw new Error('此版本 macOS 产物已经生成，请先递增 package.json 的 patch 版本')
  }
  if (process.platform !== 'darwin') throw new Error('dist:mac 只能在 macOS 上运行')

  const checkEnv = { ...process.env, PATH: path.join(root, 'node_modules', '.bin') + path.delimiter + process.env.PATH }
  for (const name of ['typecheck', 'test:unit']) {
    console.log('macOS release gate:', name)
    execSync(pkg.scripts[name], { cwd: root, stdio: 'inherit', env: checkEnv })
  }
  execFileSync(process.execPath, [path.join(root, 'node_modules/electron-vite/bin/electron-vite.js'), 'build'], {
    cwd: root,
    stdio: 'inherit'
  })
  await build({
    targets: Platform.MAC.createTarget(['dir']),
    config: {
      directories: { output },
      electronDist: path.join(root, 'node_modules/electron/dist'),
      mac: { identity: null }
    }
  })
  if (!existsSync(appPath)) throw new Error(`未找到 macOS app：${appPath}`)

  // electron-builder 在 identity=null 时只做 linker 签名；本地/分发预览前补 ad-hoc 签名。
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
  const zip = path.join(output, `LightTodo-${pkg.version}-arm64.zip`)
  if (existsSync(zip)) require('node:fs').unlinkSync(zip)
  execFileSync('ditto', ['-c', '-k', '--keepParent', appPath, zip], { stdio: 'inherit' })

  const artifacts = [appPath, zip].map((file) => {
    const data = require('node:fs').statSync(file)
    const hash = file === zip
      ? crypto.createHash('sha256').update(readFileSync(file)).digest('hex')
      : null
    return { name: path.relative(output, file), bytes: data.size, ...(hash ? { sha256: hash } : {}) }
  })
  writeFileSync(path.join(output, 'checksums.json'), JSON.stringify({
    checks: ['typecheck', 'test:unit', 'mac-app-sign', 'mac-app-zip'],
    platform: 'darwin',
    arch: 'arm64',
    files: artifacts
  }, null, 2) + '\n')
  console.log('READY', zip)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
