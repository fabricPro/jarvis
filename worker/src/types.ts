/** Görev ve durum veri modeli. */

export interface Task {
  id: string
  title: string
  done: boolean
  createdAt: string // ISO 8601
  completedAt?: string // ISO 8601
}

export interface LogEntry {
  at: string // ISO 8601
  text: string
}

/** KV'de tek anahtar altında tutulan tüm kullanıcı durumu. */
export interface TaskState {
  tasks: Task[]
  log: LogEntry[]
  updatedAt: string // ISO 8601
}

export function emptyState(now: string): TaskState {
  return { tasks: [], log: [], updatedAt: now }
}
