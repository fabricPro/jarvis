import type { Subtask, Task, TaskState } from './types'

/** Gemini'nin döndürdüğü ham görev şekli (id ve timestamp Worker'da atanır). */
export interface ModelSubtask {
  id?: string
  title: string
  done: boolean
}

export interface ModelTask {
  id?: string
  title: string
  group?: string
  done: boolean
  subtasks?: ModelSubtask[]
}

/**
 * Gemini'nin ürettiği görev listesini önceki durumla uzlaştırır.
 *
 * - id verilmişse önceki görev/alt görevle eşleşir → createdAt korunur.
 * - done false→true geçişinde completedAt = now damgalanır ve zaman damgalı log yazılır.
 * - id verilmemişse yeni görev/alt görev: yeni id + (görevde) createdAt = now.
 *
 * Saf fonksiyon: prev'i değiştirmez, yeni bir TaskState döndürür.
 */
export function reconcile(prev: TaskState, modelTasks: ModelTask[], now: string): TaskState {
  const prevById = new Map(prev.tasks.map((t) => [t.id, t]))
  const logAdditions: TaskState['log'] = []

  const tasks: Task[] = modelTasks.map((mt) => {
    const existing = mt.id ? prevById.get(mt.id) : undefined
    const prevSubById = new Map((existing?.subtasks ?? []).map((s) => [s.id, s]))

    const subtasks: Subtask[] = (mt.subtasks ?? []).map((ms) => {
      const prevSub = ms.id ? prevSubById.get(ms.id) : undefined
      const justDone = ms.done && !(prevSub?.done ?? false)
      if (justDone) {
        logAdditions.push({ at: now, text: `Tamamlandı: ${mt.title} › ${ms.title}` })
      }
      return {
        id: prevSub?.id ?? crypto.randomUUID(),
        title: ms.title,
        done: ms.done,
        completedAt: ms.done ? (prevSub?.completedAt ?? now) : undefined,
      }
    })

    const justDone = mt.done && !(existing?.done ?? false)
    if (justDone) {
      logAdditions.push({ at: now, text: `Tamamlandı: ${mt.title}` })
    }

    return {
      id: existing?.id ?? crypto.randomUUID(),
      title: mt.title,
      group: mt.group,
      done: mt.done,
      createdAt: existing?.createdAt ?? now,
      completedAt: mt.done ? (existing?.completedAt ?? now) : undefined,
      subtasks,
    }
  })

  return {
    tasks,
    log: [...prev.log, ...logAdditions],
    updatedAt: now,
  }
}
