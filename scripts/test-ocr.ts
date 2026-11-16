import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createEngine } from '@arcships/light-ocr-runtime'

/**
 * OCR 回归：确认随包的 OnnxOCR（PP-OCRv5 mobile）模型包完整，
 * 且 native runtime 能加载并识别中文截图。
 */

const bundle = join(process.cwd(), 'build', 'ocr-model')
assert.ok(existsSync(join(bundle, 'manifest.json')), '缺少 build/ocr-model/manifest.json')

// 1) 模型包清单与 SHA256SUMS 必须完全一致（native loader 也会校验）。
const sums = readFileSync(join(bundle, 'SHA256SUMS'), 'utf8')
  .split('\n')
  .filter(Boolean)
assert.ok(sums.length >= 8, `SHA256SUMS 条目过少：${sums.length}`)
for (const line of sums) {
  const match = /^([0-9a-f]{64})  (.+)$/.exec(line)
  assert.ok(match, `SHA256SUMS 行格式错误：${line}`)
  const [, expected, relative] = match
  const file = join(bundle, relative)
  assert.ok(existsSync(file), `模型包缺文件：${relative}`)
  const actual = createHash('sha256').update(readFileSync(file)).digest('hex')
  assert.equal(actual, expected, `${relative} 的 SHA-256 不匹配`)
}
assert.ok(sums.some((line) => line.endsWith('  manifest.json')), 'SHA256SUMS 未覆盖 manifest.json')

// 2) 字典与配置必须自洽（native loader 会按该数量校验识别类别数）。
const dictionary = JSON.parse(readFileSync(join(bundle, 'rec', 'dictionary.json'), 'utf8')) as {
  characters: string[]
  schemaVersion: string
}
const config = JSON.parse(readFileSync(join(bundle, 'normalized-config.json'), 'utf8')) as {
  bundleId: string
  recognition: { decode: { dictionaryEntries: number } }
}
const manifest = JSON.parse(readFileSync(join(bundle, 'manifest.json'), 'utf8')) as {
  bundleId: string
}
assert.equal(dictionary.schemaVersion, '1.0')
assert.equal(dictionary.characters.length, config.recognition.decode.dictionaryEntries)
assert.equal(dictionary.characters.at(-1), ' ')
assert.equal(config.bundleId, manifest.bundleId)

// 3) 真实识别一条中文任务文本截图。
const engine = await createEngine({
  bundlePath: bundle,
  recognitionScoreThreshold: 0.1,
  recognitionBatchSize: 8
})
try {
  const png = readFileSync(join(process.cwd(), 'scripts', 'fixtures', 'ocr-sample.png'))
  const result = await engine.recognizeEncoded(png)
  const text = result.lines.map((line) => line.text).join('\n')
  assert.ok(result.lines.length >= 3, `识别行数过少：${result.lines.length}`)
  assert.ok(text.includes('前端重构'), `未识别到「前端重构」：${text}`)
  assert.ok(text.includes('TaskCard'), `未识别到「TaskCard」：${text}`)
  assert.ok(text.includes('0.6.20'), `未识别到「0.6.20」：${text}`)
} finally {
  await engine.close()
}

console.log('PASS OCR 模型包完整性与中文识别（OnnxOCR PP-OCRv5 mobile）')
