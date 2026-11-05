/**
 * 快速添加的默认日期：日历视图里优先使用当前点选的那一天；
 * 全局捕获（inbox）不继承日历日期，显式传入的日期始终优先。
 */
export function resolveQuickAddDate(
  explicit: string | undefined,
  viewType: string,
  calendarDate: string | null,
  inbox: boolean
): string | null {
  if (explicit) return explicit
  if (!inbox && viewType === 'calendar') return calendarDate
  return null
}
