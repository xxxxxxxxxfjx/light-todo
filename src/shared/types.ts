export type ViewKey =
  | 'inbox'
  | 'today'
  | 'upcoming'
  | 'all'
  | 'someday'
  | 'completed'
  | 'trash'
  | 'calendar'
  | 'review'
  | 'list'
  | 'tag'

export interface WeeklyReviewData {
  /** 最近 7 天，从旧到新（今天在最后）。 */
  days: { date: string; completed: number; created: number }[]
  /** 最近约 13 周的完成热力图，按周一对齐，最后一天是今天。 */
  heatmap: { date: string; completed: number }[]
  completed: number
  created: number
  overdue: number
  active: number
  lists: {
    id: string
    name: string
    color: string | null
    completed: number
    active: number
  }[]
}

export interface Tag {
  id: string
  name: string
  color: string | null
  count?: number
}

export interface Folder {
  id: string
  name: string
  sortOrder: number
  createdAt: string
}

export interface List {
  id: string
  folderId: string | null
  name: string
  color: string | null
  icon: string | null
  sortOrder: number
  isPinned: number
  archivedAt: string | null
  createdAt: string
  count?: number
}

export interface Task {
  id: string
  listId: string | null
  parentId: string | null
  title: string
  notes: string
  priority: number
  status: number
  someday: boolean
  scheduledDate: string | null
  dueAt: string | null
  dueAllDay: number
  rrule: string | null
  repeatFrom: 'due' | 'completion' | null
  reminderAt: string | null
  reminderOffset: number | null
  notifiedAt: string | null
  completedAt: string | null
  deletedAt: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
  tags: Tag[]
  subtaskCount: number
  subtaskDone: number
  subtasks?: Task[]
  nextOccurrenceId?: string | null
}

export interface CreateTaskInput {
  title: string
  notes?: string
  listId?: string | null
  parentId?: string | null
  priority?: number
  someday?: boolean
  scheduledDate?: string | null
  dueAt?: string | null
  dueAllDay?: number
  rrule?: string | null
  repeatFrom?: 'due' | 'completion' | null
  reminderAt?: string | null
  reminderOffset?: number | null
  tagNames?: string[]
}

export interface UpdateTaskInput {
  title?: string
  notes?: string
  listId?: string | null
  priority?: number
  someday?: boolean
  scheduledDate?: string | null
  dueAt?: string | null
  dueAllDay?: number
  rrule?: string | null
  repeatFrom?: 'due' | 'completion' | null
  reminderAt?: string | null
  reminderOffset?: number | null
  tagNames?: string[]
}

export interface SidebarData {
  folders: Folder[]
  lists: List[]
  tags: Tag[]
  counts: Record<string, number>
}

export interface AppInfo {
  version: string
  dataDir: string
  platform: string
  theme?: 'system' | 'light' | 'dark'
}
