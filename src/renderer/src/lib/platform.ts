/** 渲染层平台判断与快捷键文案：Windows 用 Ctrl，macOS 用 ⌘。 */
export const isMac = typeof navigator !== 'undefined' && /Macintosh|Mac OS X/i.test(navigator.userAgent)

export const mod = isMac ? '⌘' : 'Ctrl'

/** 例：modKey('F') -> ⌘F / Ctrl+F；modKey('N', true) -> ⌘⇧N / Ctrl+Shift+N。 */
export function modKey(key: string, shift = false): string {
  return isMac ? `${mod}${shift ? '⇧' : ''}${key}` : `Ctrl+${shift ? 'Shift+' : ''}${key}`
}

/** 全局捕获快捷键：Windows Ctrl+Alt+Space，macOS ⌘⌥Space。 */
export const globalCaptureLabel = isMac ? '⌘⌥Space' : 'Ctrl+Alt+Space'
