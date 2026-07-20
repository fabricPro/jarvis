import type { Task, TaskState } from './types'

/**
 * PLACEHOLDER reducer — Gemini'siz, deterministik kurallarla çalışır.
 *
 * İleride bu fonksiyonun yerini "mevcut durum + mesaj → Gemini → güncel durum JSON"
 * akışı alacak. Şimdilik amaç KV okuma/yazma hattını uçtan uca doğrulamak.
 *
 * Desteklenen basit komutlar:
 *   - "rapor"                         → durumu değiştirmeden gün sonu raporu döner
 *   - "bitirdim/tamamladım/yaptım X"  → eşleşen ilk açık görevi tamamlar + log yazar
 *   - diğer her mesaj                 → yeni görev ekler
 */

export interface ReduceResult {
  state: TaskState
  reply: string
}

const DONE_PREFIX = /^(bitirdim|tamamladım|tamamladim|yaptım|yaptim|bitir)\b\s*(.*)$/i

export function reduce(prev: TaskState, message: string, now: string): ReduceResult {
  const text = message.trim()
  const lower = text.toLocaleLowerCase('tr-TR')

  // --- rapor ---
  if (lower === 'rapor' || lower.startsWith('rapor ')) {
    return { state: { ...prev, updatedAt: now }, reply: buildReport(prev) }
  }

  // --- görev tamamlama ---
  const doneMatch = text.match(DONE_PREFIX)
  if (doneMatch) {
    const hint = doneMatch[2]?.trim() ?? ''
    return completeTask(prev, hint, now)
  }

  // --- yeni görev ekle ---
  const task: Task = {
    id: crypto.randomUUID(),
    title: text,
    done: false,
    createdAt: now,
    subtasks: [],
  }
  const state: TaskState = {
    ...prev,
    tasks: [...prev.tasks, task],
    updatedAt: now,
  }
  return { state, reply: `Görev eklendi: "${task.title}".` }
}

function completeTask(prev: TaskState, hint: string, now: string): ReduceResult {
  const open = prev.tasks.filter((t) => !t.done)
  if (open.length === 0) {
    return { state: { ...prev, updatedAt: now }, reply: 'Açık görev yok.' }
  }

  // İpucu verilmişse başlığında geçen ilk açık görevi, yoksa en eski açık görevi seç.
  const hintLower = hint.toLocaleLowerCase('tr-TR')
  const target =
    (hint && open.find((t) => t.title.toLocaleLowerCase('tr-TR').includes(hintLower))) || open[0]

  const tasks = prev.tasks.map((t) =>
    t.id === target.id ? { ...t, done: true, completedAt: now } : t,
  )
  const log = [...prev.log, { at: now, text: `Tamamlandı: ${target.title}` }]

  return {
    state: { ...prev, tasks, log, updatedAt: now },
    reply: `"${target.title}" tamamlandı olarak işaretlendi.`,
  }
}

function buildReport(state: TaskState): string {
  const done = state.tasks.filter((t) => t.done)
  const open = state.tasks.filter((t) => !t.done)

  const lines: string[] = ['📋 Gün sonu raporu']
  lines.push(`Tamamlanan: ${done.length} · Açık: ${open.length}`)

  if (done.length > 0) {
    lines.push('', 'Tamamlananlar:')
    for (const t of done) lines.push(`  ✓ ${t.title}`)
  }
  if (open.length > 0) {
    lines.push('', 'Açık görevler:')
    for (const t of open) lines.push(`  • ${t.title}`)
  }

  return lines.join('\n')
}
