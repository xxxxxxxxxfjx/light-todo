#!/usr/bin/env node
/**
 * 开发期 CDP 取值工具（仅用于本地诊断，不参与应用运行时）。
 * 用法：node scripts/cdp-eval.mjs <port> "<js expression>"
 */
const port = process.argv[2] ?? '9222'
const expression = process.argv[3] ?? 'document.title'

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
const target =
  targets.find((t) => t.type === 'page' && t.url.includes('index.html')) ??
  targets.find((t) => t.type === 'page')
if (!target) throw new Error('没有找到 page target')

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})

const id = Date.now()
const response = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('CDP evaluate 超时')), 15000)
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id !== id) return
    clearTimeout(timer)
    resolve(message)
  })
  ws.send(
    JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true }
    })
  )
})
ws.close()

if (response.error) {
  console.error(JSON.stringify(response.error, null, 2))
  process.exit(1)
}
if (response.result?.exceptionDetails) {
  console.error(JSON.stringify(response.result.exceptionDetails, null, 2))
  process.exit(1)
}
const value = response.result?.result?.value
console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
