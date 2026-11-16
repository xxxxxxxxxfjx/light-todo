import { app, clipboard, nativeImage } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createEngine, type OcrEngine } from '@arcships/light-ocr-runtime'
import { normalizeCaptureText } from '../shared/capture-parse.ts'

function ocrScriptPath(): string {
  const candidates = [
    join(app.getAppPath(), 'scripts', 'ocr.ps1'),
    join(process.resourcesPath, 'ocr.ps1')
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? ''
}

/**
 * OnnxOCR (PaddleOCR PP-OCRv5 mobile det + rec, ~21MB) ships as the
 * `ocr-model` extra resource. The bundle keeps light-ocr's on-disk
 * envelope so the native runtime can load it without a model package.
 */
function modelBundlePath(): string {
  const candidates = [
    join(process.resourcesPath, 'ocr-model'),
    join(app.getAppPath(), 'build', 'ocr-model')
  ]
  return (
    candidates.find((candidate) => existsSync(join(candidate, 'manifest.json'))) ?? ''
  )
}

export interface OcrResult {
  text: string
  lines: string[]
}

let enginePromise: Promise<OcrEngine> | null = null

function onnxEngine(): Promise<OcrEngine> {
  if (!enginePromise) {
    const bundlePath = modelBundlePath()
    if (!bundlePath) {
      enginePromise = Promise.reject(new Error('OCR 模型缺失，请重新安装完整程序'))
      enginePromise.catch(() => {
        enginePromise = null
      })
      return enginePromise
    }
    enginePromise = createEngine({
      bundlePath,
      recognitionScoreThreshold: 0.1,
      recognitionBatchSize: 8
    }).catch((error) => {
      enginePromise = null
      throw error
    })
  }
  return enginePromise
}

/** 小图识别前做适度放大（仅原图识别失败后作为第二策略使用）。 */
function upscaleForOcr(buffer: Buffer, targetLongest: number): Buffer {
  try {
    const image = nativeImage.createFromBuffer(buffer)
    const size = image.getSize()
    const longest = Math.max(size.width, size.height)
    if (longest > 0 && longest < targetLongest) {
      const scale = Math.min(4, targetLongest / longest)
      return image
        .resize({
          width: Math.round(size.width * scale),
          height: Math.round(size.height * scale),
          quality: 'best'
        })
        .toPNG()
    }
  } catch {
    /* use original bytes */
  }
  return buffer
}

/** 用本地 OCR 引擎识别，空结果时返回 null（不抛错）。 */
async function tryOnnx(png: Buffer): Promise<OcrResult | null> {
  const engine = await onnxEngine()
  const result = await engine.recognizeEncoded(png)
  const lines = result.lines.map((line) => line.text.trim()).filter(Boolean)
  const text = normalizeCaptureText(lines.join('\n'))
  if (!text) return null
  return { text, lines: text.split('\n').map((line) => line.trim()).filter(Boolean) }
}

/**
 * Windows built-in OCR fallback, used only when the OnnxOCR runtime cannot
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

/** Recognise one PNG buffer with a three-tier strategy:
 *  1. OnnxOCR PP-OCRv5 模型直接识别原图
 *  2. 放大后重试（对极小/低分辨率截图）
 *  3. Windows OCR 兜底
 */
export async function ocrImageBuffer(buffer: Buffer): Promise<OcrResult> {
  // 第 1 层：原样识别
  try {
    const direct = await tryOnnx(buffer)
    if (direct) return direct
    console.warn('ONNX_OCR_EMPTY direct')
  } catch (error) {
    console.warn('ONNX_OCR_FAILED direct', error)
  }

  // 第 2 层：放大后重试
  try {
    const scaled = upscaleForOcr(buffer, 960)
    if (scaled !== buffer) {
      const retry = await tryOnnx(scaled)
      if (retry) return retry
      console.warn('ONNX_OCR_EMPTY upscaled')
    }
  } catch (error) {
    console.warn('ONNX_OCR_FAILED upscaled', error)
  }

  // 第 3 层：Windows OCR 兜底
  if (process.platform === 'win32') {
    const text = normalizeCaptureText(await runWindowsOcr(buffer))
    if (text) {
      return { text, lines: text.split('\n').map((line) => line.trim()).filter(Boolean) }
    }
  }

  throw new Error('没有识别到文字')
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
