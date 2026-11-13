import { sortReportTitles } from './report-sort.ts'

/**
 * 周复盘里的周报：
 *
 * 2026/11/09 - 2026/11/15：
 * 1. 写完周报
 * 2. 整理下周计划
 */
export function buildWeekReport(
  startKey: string,
  endKey: string,
  tasks: Array<{ title: string }>
): string {
  const range = `${startKey.replace(/-/g, '/')} - ${endKey.replace(/-/g, '/')}`
  const lines = sortReportTitles(tasks).map((task, index) => {
    const title = task.title.replace(/\s*\n+\s*/g, ' ').trim()
    return `${index + 1}. ${title}`
  })
  return [`${range}：`, ...lines].join('\n')
}
