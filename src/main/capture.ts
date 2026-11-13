import { app, BrowserWindow, desktopCapturer, ipcMain, screen } from 'electron'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Best-effort geometry log: one line per capture, helps diagnose DPI/multi-screen issues. */
function debugLog(message: string): void {
  try {
    appendFileSync(join(app.getPath('userData'), 'startup.log'), `${new Date().toISOString()} ${message}\n`)
  } catch {
    /* best effort */
  }
}

interface SelectionRect {
  x: number
  y: number
  width: number
  height: number
  /** 原始屏幕物理坐标（e.screenX/Y），不受覆盖层窗口位置/尺寸影响。 */
  screenX: number
  screenY: number
  screenW: number
  screenH: number
}

const OVERLAY_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;overflow:hidden;background:#000;cursor:crosshair;font:12px 'Microsoft YaHei UI',system-ui}
  #shot{position:fixed;inset:0;width:100vw;height:100vh;object-fit:fill;user-select:none;-webkit-user-drag:none}
  #mask{position:fixed;inset:0;background:rgba(0,0,0,.28)}
  #sel{position:fixed;display:none;border:2px solid #4da3e8;box-shadow:0 0 0 9999px rgba(0,0,0,.42);}
  #tip{position:fixed;left:50%;top:16px;transform:translateX(-50%);padding:6px 12px;border-radius:999px;
       background:rgba(20,20,24,.82);color:#fff;letter-spacing:.02em;pointer-events:none}
  #size{position:fixed;padding:2px 6px;border-radius:5px;background:rgba(20,20,24,.82);color:#fff;display:none;pointer-events:none}
</style></head><body>
  <img id="shot" src="shot.png" alt="">
  <div id="mask"></div>
  <div id="sel"></div>
  <div id="size"></div>
  <div id="tip">拖拽选择区域 · Esc 取消</div>
  <script>
  (function () {
    var sx = 0, sy = 0, dragging = false, done = false, sScrX = 0, sScrY = 0;
    function clamp(v, max) { return Math.max(0, Math.min(max, v)); }
    function draw(x, y, sX, sY) {
      var left = Math.min(sx, x), top = Math.min(sy, y);
      var w = Math.abs(x - sx), h = Math.abs(y - sy);
      var sw = Math.abs(sX - sScrX), sh = Math.abs(sY - sScrY);
      sel.style.left = left + 'px'; sel.style.top = top + 'px';
      sel.style.width = w + 'px'; sel.style.height = h + 'px';
      size.style.display = 'block';
      size.style.left = Math.min(window.innerWidth - 60, left + w + 6) + 'px';
      size.style.top = Math.max(4, top - 22) + 'px';
      size.textContent = Math.round(sw) + ' × ' + Math.round(sh);
      return { sw: sw, sh: sh };
    }
    window.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      dragging = true;
      sx = clamp(e.clientX, window.innerWidth); sy = clamp(e.clientY, window.innerHeight);
      sScrX = e.screenX; sScrY = e.screenY;
      sel.style.display = 'block'; tip.style.display = 'none';
      draw(sx, sy, sScrX, sScrY);
      e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
      if (dragging) draw(clamp(e.clientX, window.innerWidth), clamp(e.clientY, window.innerHeight), e.screenX, e.screenY);
    });
    window.addEventListener('mouseup', function (e) {
      if (!dragging || done) return;
      dragging = false; done = true;
      var x = clamp(e.clientX, window.innerWidth), y = clamp(e.clientY, window.innerHeight);
      var dims = draw(x, y, e.screenX, e.screenY);
      var w = Math.abs(x - sx), h = Math.abs(y - sy);
      if (w < 6 || h < 6) { require('electron').ipcRenderer.send('capture:region-result', null); return; }
      require('electron').ipcRenderer.send('capture:region-result', {
        x: Math.min(sx, x), y: Math.min(sy, y), width: w, height: h,
        screenX: Math.min(sScrX, e.screenX), screenY: Math.min(sScrY, e.screenY),
        screenW: dims.sw, screenH: dims.sh
      });
    });
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !done) { done = true; require('electron').ipcRenderer.send('capture:region-result', null); }
    });
    window.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      if (!done) { done = true; require('electron').ipcRenderer.send('capture:region-result', null); }
    });
  })();
  </script>
</body></html>`

/**
 * Capture one screen region on the primary display.
 * Returns a PNG buffer, or null when the user cancels.
 */
export async function captureScreenRegion(): Promise<Buffer | null> {
  // 跟随鼠标所在显示器：多屏用户按快捷键时，框选的应该是眼前这一块屏幕。
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const scale = display.scaleFactor
  const thumbnailSize = {
    width: Math.round(display.size.width * scale),
    height: Math.round(display.size.height * scale)
  }
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize,
    fetchWindowIcons: false
  })
  const displayIndex = screen.getAllDisplays().findIndex((item) => item.id === display.id)
  const source =
    sources.find((item) => item.display_id === String(display.id)) ??
    (displayIndex >= 0 ? sources[displayIndex] : undefined) ??
    sources[0]
  if (!source) throw new Error('无法捕获屏幕')
  const full = source.thumbnail
  if (full.isEmpty()) throw new Error('屏幕捕获为空')

  const base = join(app.getPath('userData'), 'tmp')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'shot-'))
  const imagePath = join(dir, 'shot.png')
  const htmlPath = join(dir, 'overlay.html')
  writeFileSync(imagePath, full.toPNG())
  writeFileSync(htmlPath, OVERLAY_HTML)

  const overlay = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    useContentSize: true,
    frame: false,
    transparent: false,
    backgroundColor: '#000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    thickFrame: false,
    show: false,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false
    }
  })
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Windows 会把普通无边框窗口限制在工作区（任务栏以上），导致 1080 高的
  // 屏幕上窗口只有 ~1040。截图覆盖层必须盖住整个屏幕，否则截图画面被压
  // 扁、框选位置对不上（用户看到的偏移就是这么来的）。
  overlay.setBounds(display.bounds)
  const overlayBounds = overlay.getBounds()
  debugLog(
    `CAPTURE_OVERLAY bounds=${overlayBounds.width}x${overlayBounds.height} at (${overlayBounds.x},${overlayBounds.y}) display=${display.bounds.width}x${display.bounds.height}`
  )

  let settle: (rect: SelectionRect | null) => void = () => {}
  const resultPromise = new Promise<SelectionRect | null>((resolve) => {
    settle = resolve
  })
  const onResult = (_event: unknown, rect: SelectionRect | null): void => {
    ipcMain.removeListener('capture:region-result', onResult)
    settle(rect)
  }
  ipcMain.on('capture:region-result', onResult)
  overlay.on('closed', () => {
    ipcMain.removeListener('capture:region-result', onResult)
    settle(null)
  })

  try {
    await overlay.loadFile(htmlPath)
    overlay.show()
    overlay.focus()
    const rect = await Promise.race([
      resultPromise,
      new Promise<SelectionRect | null>((resolve) => setTimeout(() => resolve(null), 120_000))
    ])
    if (!rect) return null

    const fullSize = full.getSize()
    const scaleX = display.bounds.width > 0 ? fullSize.width / display.bounds.width : scale
    const scaleY = display.bounds.height > 0 ? fullSize.height / display.bounds.height : scale

    debugLog(
      `CAPTURE_GEOM display=${JSON.stringify(display.bounds)} dip=${display.size.width}x${display.size.height} scale=${scale} full=${fullSize.width}x${fullSize.height} rect=${JSON.stringify(rect)}`
    )

    // 优先用原始屏幕物理坐标（e.screenX/Y）裁剪：覆盖层窗口可能被系统
    // 限制为工作区大小（1080 高的屏幕上只有 1040），用窗口内 CSS 坐标
    // 会产生几十像素偏移。screenX/Y 与 desktopCapturer 位图同为物理像素。
    if (Number.isFinite(rect.screenX) && Number.isFinite(rect.screenY) && rect.screenW > 6 && rect.screenH > 6) {
      const originX = display.bounds.x * scale
      const originY = display.bounds.y * scale
      const x = Math.max(0, Math.min(fullSize.width - 1, Math.round(rect.screenX - originX)))
      const y = Math.max(0, Math.min(fullSize.height - 1, Math.round(rect.screenY - originY)))
      const width = Math.max(1, Math.min(fullSize.width - x, Math.round(rect.screenW)))
      const height = Math.max(1, Math.min(fullSize.height - y, Math.round(rect.screenH)))
      const crop = full.crop({ x, y, width, height })
      debugLog(`CAPTURE_CROP screenCrop=${width}x${height} at (${x},${y})`)
      return crop.toPNG()
    }

    // 兜底：用窗口内 CSS 坐标按实际位图比例换算（DPI 取整差异）。
    const x = Math.max(0, Math.min(fullSize.width - 1, Math.round(rect.x * scaleX)))
    const y = Math.max(0, Math.min(fullSize.height - 1, Math.round(rect.y * scaleY)))
    const width = Math.max(1, Math.min(fullSize.width - x, Math.round(rect.width * scaleX)))
    const height = Math.max(1, Math.min(fullSize.height - y, Math.round(rect.height * scaleY)))
    const crop = full.crop({ x, y, width, height })
    debugLog(`CAPTURE_CROP bitmapCrop=${width}x${height}`)
    return crop.toPNG()
  } finally {
    if (!overlay.isDestroyed()) overlay.destroy()
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
}
