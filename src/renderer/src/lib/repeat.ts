export function repeatLabel(rule: string): string {
  const days: Record<string,string> = { MO:'一', TU:'二', WE:'三', TH:'四', FR:'五', SA:'六', SU:'日' }
  const interval = Number(/INTERVAL=(\d+)/.exec(rule)?.[1] ?? 1)
  const freq = /FREQ=(\w+)/.exec(rule)?.[1]
  const unit = ({ DAILY:'天', WEEKLY:'周', MONTHLY:'月', YEARLY:'年' } as Record<string,string>)[freq ?? ''] ?? '次'
  let label = interval === 1 ? `每${unit}` : `每 ${interval} ${unit}`
  const byday = /BYDAY=([^;]+)/.exec(rule)?.[1]
  if (byday === 'MO,TU,WE,TH,FR') return '每个工作日'
  if (byday) label += `（周${byday.split(',').map(d => days[d] ?? d).join('、')}）`
  const monthday = /BYMONTHDAY=(\d+)/.exec(rule)?.[1]
  if (monthday) label += ` ${monthday} 日`
  return label
}
