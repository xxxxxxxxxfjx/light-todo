import { app, clipboard, nativeImage } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
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

/**
 * Run the Windows OCR helper, piping the PNG through stdin.
 * Reading a temp file from the child is unreliable under restricted tokens,
 * so the image never touches disk.
 */
function runOcr(png: Buffer): Promise<string> {
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

/** Recognise one PNG buffer with the built-in Windows OCR engine. */
export async function ocrImageBuffer(buffer: Buffer): Promise<OcrResult> {
  // Windows OCR is much better on larger glyphs; UI screenshots are usually
  // 11-13px text, so upscale small captures before recognition.
  let png = buffer
  try {
    const image = nativeImage.createFromBuffer(buffer)
    const size = image.getSize()
    const longest = Math.max(size.width, size.height)
    if (longest > 0 && longest < 1600) {
      const scale = Math.min(3, Math.max(2, Math.ceil(1600 / longest)))
      png = image.resize({ width: size.width * scale, height: size.height * scale, quality: 'best' }).toPNG()
    }
  } catch {
    /* fall back to the original bytes */
  }
  const text = normalizeCaptureText(await runOcr(png))
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
