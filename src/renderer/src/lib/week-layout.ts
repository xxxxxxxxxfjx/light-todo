import type { Task } from '@shared/types'

const HOUR_HEIGHT = 44
const GROUP_HEADER = 22
const TASK_HEIGHT = 22
const GROUP_GAP = 6

export interface WeekEventGroup {
  start: number
  top: number
  height: number
  tasks: Task[]
}

export interface WeekHourSlot { top: number; height: number }

function groupTasks(tasks: Task[]): WeekEventGroup[] {
  const byStart = new Map<number, Task[]>()
  for (const task of tasks) {
    const date = new Date(task.dueAt!)
    if (!Number.isFinite(date.getTime())) continue
    const start = date.getHours() * 60 + date.getMinutes()
    const group = byStart.get(start)
    if (group) group.push(task)
    else byStart.set(start, [task])
  }

  return [...byStart.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, tasks]) => ({ start, top: 0, height: GROUP_HEADER + tasks.length * TASK_HEIGHT + 4, tasks }))
}

// Expand busy hours across the whole week. Stacked reminders stay inside their
// actual hour instead of being pushed down over a later hour's grid line.
export function layoutWeekSchedule(days: Task[][]): { days: WeekEventGroup[][]; hours: WeekHourSlot[]; height: number } {
  const groups = days.map(groupTasks)
  const hourHeights = Array<number>(24).fill(HOUR_HEIGHT)
  for (const day of groups) {
    const bottoms = Array<number>(24).fill(GROUP_GAP)
    for (const group of day) {
      const hour = Math.floor(group.start / 60)
      group.top = Math.max(bottoms[hour], (group.start % 60) / 60 * HOUR_HEIGHT + GROUP_GAP)
      bottoms[hour] = group.top + group.height + GROUP_GAP
      hourHeights[hour] = Math.max(hourHeights[hour], bottoms[hour])
    }
  }
  let height = 0
  const hours = hourHeights.map(slotHeight => {
    const slot = { top: height, height: slotHeight }
    height += slotHeight
    return slot
  })
  for (const day of groups) for (const group of day) group.top += hours[Math.floor(group.start / 60)].top
  return { days: groups, hours, height }
}
