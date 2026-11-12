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
  | 'filter'

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
  /** 预计用时（分钟）；null 表示未估时。 */
  estimateMin: number | null
  /** 已记录的实际用时（分钟），由计时/手动补记累加。 */
  actualMin: number | null
  /** 所属清单分区（Heading）；null 表示未分区。 */
  sectionId: string | null
  /** 持续提醒间隔（分钟）；null 表示只响一次。 */
  escalateInterval: number | null
  /** 持续提醒截止时间；null 表示不自动停止。 */
  escalateUntil: string | null
  /** 下一次持续提醒时间。 */
  nextEscalateAt: string | null
  /** 紧急任务：到点弹置顶强提醒。 */
  urgent: boolean
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
  estimateMin?: number | null
  sectionId?: string | null
  escalateInterval?: number | null
  escalateUntil?: string | null
  urgent?: boolean
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
  estimateMin?: number | null
  actualMin?: number | null
  sectionId?: string | null
  escalateInterval?: number | null
  escalateUntil?: string | null
  urgent?: boolean
  tagNames?: string[]
}

export interface ListSection {
  id: string
  listId: string
  name: string
  sortOrder: number
  collapsed: boolean
  createdAt: string
}

export type FilterField =
  | 'priority'
  | 'list'
  | 'tag'
  | 'scheduled'
  | 'due'
  | 'someday'
  | 'status'
  | 'text'
  | 'overdue'
  | 'nodate'

export type FilterOp =
  | 'is'
  | 'isNot'
  | 'gte'
  | 'lte'
  | 'before'
  | 'after'
  | 'empty'
  | 'notEmpty'
  | 'contains'

export interface FilterCondition {
  field: FilterField
  op: FilterOp
  value: string
}

export interface FilterQuery {
  match: 'all' | 'any'
  conditions: FilterCondition[]
}

export interface SavedFilter {
  id: string
  name: string
  query: FilterQuery
  color: string | null
  pinned: number
  sortOrder: number
  createdAt: string
  count?: number
}

export interface DayReview {
  date: string
  rating: number | null
  note: string
  reviewedAt: string
}

export interface ReplanPending {
  enabled: boolean
  shownToday: boolean
  tasks: Task[]
}

export interface CaptureResult {
  /** PNG data URL shown on the left of the capture dialog. */
  image: string
  /** Full OCR text, used as the editable notes. */
  text: string
  lines: string[]
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
