const fs = require('node:fs')
const { pipeline } = require('node:stream/promises')
const { Readable } = require('node:stream')
const path = require('node:path')

const url = process.argv[2]
const dest = process.argv[3]

async function main() {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') || 0)
  let received = 0
  let last = 0
  const body = Readable.fromWeb(res.body)
  body.on('data', (chunk) => {
    received += chunk.length
    const now = Date.now()
    if (now - last > 3000) {
      last = now
      const pct = total ? ((received / total) * 100).toFixed(1) : '?'
      console.log(`progress ${pct}% ${(received / 1048576).toFixed(1)}MB`)
    }
  })
  await pipeline(body, fs.createWriteStream(dest))
  console.log('downloaded', dest, fs.statSync(dest).size)
}

main().catch((e) => {
  console.error('FAILED', e)
  process.exit(1)
})
