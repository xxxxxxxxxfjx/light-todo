import type { Task } from '../shared/types'

export type ReminderAction = 'complete' | 'snooze' | 'open'

export interface ReminderProtocol {
  action: ReminderAction
  id: string
  minutes?: number
}

export const DEFAULT_SNOOZE_MINUTES = 10
export const MIN_SNOOZE_MINUTES = 1
export const MAX_SNOOZE_MINUTES = 1440

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;'
}

/** Escape the five XML metacharacters so task titles and URLs are safe in attributes/text. */
export function escapeXml(value: string): string {
  return String(value).replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char)
}

/**
 * Build a Windows ToastGeneric payload for one reminder.
 * Protocol activation is used instead of in-process handlers so the buttons work
 * even when the toast is clicked while the app is not running.
 */
export function buildTaskToastXml(task: Pick<Task, 'id' | 'title' | 'urgent'>): string {
  const id = encodeURIComponent(task.id)
  const openUrl = `lighttodo://open?id=${id}`
  const completeUrl = `lighttodo://complete?id=${id}`
  const snoozeUrl = `lighttodo://snooze?id=${id}&minutes=${DEFAULT_SNOOZE_MINUTES}`
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<toast activationType="protocol" launch="${escapeXml(openUrl)}"${task.urgent ? ' scenario="urgent"' : ''}>`,
    '  <visual>',
    '    <binding template="ToastGeneric">',
    `      <text>${task.urgent ? '轻单 · 紧急提醒' : '轻单 · 提醒'}</text>`,
    `      <text>${escapeXml(task.title)}</text>`,
    ...(task.urgent ? ['      <text>这条任务标记为紧急，完成后才会停止催办</text>'] : []),
    '    </binding>',
    '  </visual>',
    '  <actions>',
    `    <action activationType="protocol" content="完成" arguments="${escapeXml(completeUrl)}"/>`,
    `    <action activationType="protocol" content="稍后 10 分钟" arguments="${escapeXml(snoozeUrl)}"/>`,
    '  </actions>',
    '</toast>'
  ].join('\n')
}

/**
 * Parse lighttodo://complete|snooze|open?id=...
 * Returns null for any other URL, unknown action, or missing/empty id.
 * Snooze minutes are clamped to 1..1440 and default to 10 when absent/invalid.
 */
export function parseReminderProtocol(url: string): ReminderProtocol | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'lighttodo:') return null

  const action = parsed.hostname
  if (action !== 'complete' && action !== 'snooze' && action !== 'open') return null

  const id = parsed.searchParams.get('id')?.trim()
  if (!id) return null

  if (action === 'snooze') {
    const raw = parsed.searchParams.get('minutes')
    let minutes = DEFAULT_SNOOZE_MINUTES
    if (raw !== null && raw.trim() !== '') {
      const value = Number(raw)
      if (Number.isFinite(value)) {
        minutes = Math.min(
          MAX_SNOOZE_MINUTES,
          Math.max(MIN_SNOOZE_MINUTES, Math.round(value))
        )
      }
    }
    return { action, id, minutes }
  }

  return { action, id }
}
