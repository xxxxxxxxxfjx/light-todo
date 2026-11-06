/**
 * 已完成视图的每日日报：
 *
 * 2026/11/06：
 * 1. 写完周报
 * 2. 跑步 5 公里
 *
 * 只依赖任务标题，保持纯函数，方便单测与复制。
 */
export function buildDayReport(dateKey: string, tasks: Array<{ title: string }>): string {
  const date = dateKey.replace(/-/g, '/')
  const lines = tasks.map((task, index) => {
    const title = task.title.replace(/\s*\n+\s*/g, ' ').trim()
    return `${index + 1}. ${title}`
  })
  return [`${date}：`, ...lines].join('\n')
}
