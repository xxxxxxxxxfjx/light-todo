import { app, clipboard, nativeImage } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createEngine, type OcrEngine } from '@arcships/light-ocr-tiny'
import { normalizeCaptureText } from '../shared/capture-parse.ts'

function ocrScriptPath(): string {
  const candidates = [
    join(app.getAppPath(), 'scripts', 'ocr.ps1'),
    join(process.resourcesPath, 'ocr.ps1')
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? ''
}

export interface OcrResult {
  text: string
  lines: string[]
}

/** PaddleOCR PP-OCRv6 Tiny is the primary engine. It is local and ~6 MB. */
let enginePromise: Promise<OcrEngine> | null = null

function paddleEngine(): Promise<OcrEngine> {
  if (!enginePromise) {
    enginePromise = createEngine({
      recognitionScoreThreshold: 0.3,
      recognitionBatchSize: 8
    }).catch((error) => {
      enginePromise = null
      throw error
    })
  }
  return enginePromise
}

function upscaleForOcr(buffer: Buffer): Buffer {
  try {
    const image = nativeImage.createFromBuffer(buffer)
    const size = image.getSize()
    const longest = Math.max(size.width, size.height)
    if (longest > 0 && longest < 1200) {
      const scale = Math.min(2, Math.max(2, Math.ceil(1200 / longest)))
      return image.resize({ width: size.width * scale, height: size.height * scale, quality: 'best' }).toPNG()
    }
  } catch {
    /* use original bytes */
  }
  return buffer
}

async function runPaddleOcr(png: Buffer): Promise<OcrResult> {
  const engine = await paddleEngine()
  const result = await engine.recognizeEncoded(upscaleForOcr(png))
  const lines = result.lines.map((line) => line.text.trim()).filter(Boolean)
  const text = normalizeCaptureText(lines.join('\n'))
  if (!text) throw new Error('没有识别到文字')
  return { text, lines: text.split('\n').map((line) => line.trim()).filter(Boolean) }
}

/**
 * Windows built-in OCR fallback, used only when the Paddle runtime cannot
 * load (for example on a machine where the native addon is blocked).
 * The PNG is piped through stdin so it never touches disk.
 */
function runWindowsOcr(png: Buffer): Promise<string> {
  const script = ocrScriptPath()
  if (!script) return Promise.reject(new Error('OCR 脚本缺失，请重新安装完整程序'))
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return new Promise((resolve, reject) => {
    const child = spawn(
      powershell,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    )
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('OCR 超时'))
    }, 20000)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim() || `OCR 进程退出码 ${code}`))
    })
    child.stdin.end(png)
  })
}

/** Recognise one PNG buffer: PaddleOCR tiny first, Windows OCR as fallback. */
export async function ocrImageBuffer(buffer: Buffer): Promise<OcrResult> {
  try {
    return await runPaddleOcr(buffer)
  } catch (error) {
    console.warn('PADDLE_OCR_FAILED', error)
    if (process.platform !== 'win32') throw error
  }
  const text = normalizeCaptureText(await runWindowsOcr(buffer))
  if (!text) throw new Error('没有识别到文字')
  return { text, lines: text.split('\n').map((line) => line.trim()).filter(Boolean) }
}

/** Read one image from the clipboard and recognise it. */
export async function ocrClipboardImage(): Promise<OcrResult> {
  const items = await clipboard.read()
  const item = items.find((entry) => entry.types.some((type) => type.startsWith('image/')))
  if (!item) throw new Error('剪贴板里没有图片')
  const imageType = item.types.find((type) => type.startsWith('image/'))!
  const blob = (await item.getType(imageType)) as Blob
  return ocrImageBuffer(Buffer.from(await blob.arrayBuffer()))
}

/** Release native OCR resources on quit. */
export async function closeOcrEngine(): Promise<void> {
  const pending = enginePromise
  enginePromise = null
  if (!pending) return
  try {
    const engine = await pending
    await engine.close()
  } catch {
    /* engine never loaded */
  }
}
