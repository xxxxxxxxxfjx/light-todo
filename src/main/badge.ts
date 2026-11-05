import { app, BrowserWindow, nativeImage } from 'electron'
import { getSidebar } from './db'

// 16×16 red dot; Windows only renders a 16px overlay icon, the count lives in
// the tooltip/description. macOS/Linux use the native numeric badge.
const DOT_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAGGSURBVDhPtZK7TgJBFIZ5BN/AN7Czs7WRiooXsKAiVla+BDY0EigIEAIhgVBswT3EgMWSGBQMaCRBl9susIAuCOP+wyyXZRIrv+Q0Z+b/51zG8q90Q6GLfix21Y1E7Cz1N4rXezTO5++XmkbMqKL4Lvl8J+zqIXjpu93eKBeDAZlWKmQuSSxDyM9kshymUjdMsgUva53OApe0Vou8OZ3k6fx8Ey92O1HLZWqiV7fqxeOnTLpGLZWqOPxqNMiz1bon3o2hIFCTabXaY9L160bPrw4HV2gEKkFrQA6Hz6gBekcCvfJE5hgXi9RglM3eUgNFEAI0kclwBeboeDzUYCKKD9QAu0YC/fME5pATCWowKhQC1ODD7z9GYqXPoW6zcUW7gS2BvQ82q9cVJDFlnsgIye2mYqycSdfg2xqb6AeD3FV+uly0SqAkk9dMukWf6h091cFG0CsGBkOjbKAPL8skhwzTafus2VTZ3T3msrzkvsxjEI1e6hWFZ7Xa4ziXS2BT7GgHi+UX5soWEO0CKaAAAAAASUVORK5CYII='

let lastCount = -1

export function badgeDescription(count: number): string {
  return count > 0 ? `今天 ${count} 项待办` : '今天没有待办'
}

export function updateTaskbarBadge(): void {
  try {
    const count = getSidebar().counts.today
    if (count === lastCount) return
    lastCount = count
    if (process.platform === 'win32') {
      const window = BrowserWindow.getAllWindows().find(
        (item) => !item.isDestroyed() && item.getBounds().width >= 500
      )
      if (!window) return
      if (count > 0) {
        window.setOverlayIcon(nativeImage.createFromDataURL(`data:image/png;base64,${DOT_PNG}`), badgeDescription(count))
      } else {
        window.setOverlayIcon(null, badgeDescription(0))
      }
    } else {
      app.setBadgeCount(count)
    }
  } catch (error) {
    console.warn('TASKBAR_BADGE_FAILED', error)
  }
}
