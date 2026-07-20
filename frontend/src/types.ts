export type ChatRole = 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: ChatRole
  text: string
}

/** Worker'daki görev modeliyle aynı şekil. */
export interface Subtask {
  id: string
  title: string
  done: boolean
  completedAt?: string
}

export interface Task {
  id: string
  title: string
  group?: string
  done: boolean
  createdAt: string
  completedAt?: string
  subtasks: Subtask[]
}

export interface LogEntry {
  at: string
  text: string
}

export interface TaskState {
  tasks: Task[]
  log: LogEntry[]
  updatedAt: string
}
