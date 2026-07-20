import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { fetchModels, fetchState, sendChat } from './api'
import type { ChatMessage, Task, TaskState } from './types'

const MODEL_STORAGE_KEY = 'jarvis.model'

function newId(): string {
  return crypto.randomUUID()
}

interface TaskGroup {
  name?: string
  tasks: Task[]
}

/** Görevleri grup adına göre, ekleme sırasını koruyarak grupla (grupsuzlar başta). */
function groupTasks(tasks: Task[]): TaskGroup[] {
  const order: (string | undefined)[] = []
  const byGroup = new Map<string | undefined, Task[]>()
  for (const t of tasks) {
    const key = t.group || undefined
    if (!byGroup.has(key)) {
      byGroup.set(key, [])
      order.push(key)
    }
    byGroup.get(key)!.push(t)
  }
  // grupsuz kova (undefined) en başa
  order.sort((a, b) => (a === undefined ? -1 : b === undefined ? 1 : 0))
  return order.map((name) => ({ name, tasks: byGroup.get(name)! }))
}

function TaskRow({ task }: { task: Task }) {
  const total = task.subtasks.length
  const done = task.subtasks.filter((s) => s.done).length
  return (
    <li className={`task ${task.done ? 'task--done' : ''}`}>
      <div className="task__row">
        <span className="task__mark">{task.done ? '✓' : '○'}</span>
        <span className="task__title">{task.title}</span>
        {total > 0 && (
          <span className="task__progress">
            {done}/{total}
          </span>
        )}
      </div>
      {total > 0 && (
        <ul className="subtasks">
          {task.subtasks.map((s) => (
            <li key={s.id} className={`subtask ${s.done ? 'subtask--done' : ''}`}>
              <span className="task__mark">{s.done ? '✓' : '○'}</span>
              <span className="task__title">{s.title}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [taskState, setTaskState] = useState<TaskState | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState<string>(() => localStorage.getItem(MODEL_STORAGE_KEY) ?? '')

  const listEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchState()
      .then(setTaskState)
      .catch((err) => setError(err instanceof Error ? err.message : 'Durum alınamadı.'))
  }, [])

  // Seçilebilir modelleri çek; saklanan seçim geçerli değilse varsayılana düş.
  useEffect(() => {
    fetchModels()
      .then((info) => {
        setModels(info.models)
        setModel((cur) => (cur && info.models.includes(cur) ? cur : info.default))
      })
      .catch(() => {
        /* modeller alınamazsa seçici gizli kalır; Worker varsayılanı kullanır */
      })
  }, [])

  // Seçim değiştikçe kalıcı yap.
  useEffect(() => {
    if (model) localStorage.setItem(MODEL_STORAGE_KEY, model)
  }, [model])

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading) return

    setMessages((prev) => [...prev, { id: newId(), role: 'user', text }])
    setInput('')
    setError(null)
    setLoading(true)

    try {
      const { reply, state } = await sendChat(text, model || undefined)
      setMessages((prev) => [...prev, { id: newId(), role: 'assistant', text: reply }])
      setTaskState(state)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bilinmeyen bir hata oluştu.')
    } finally {
      setLoading(false)
    }
  }

  const tasks = taskState?.tasks ?? []
  const groups = useMemo(() => groupTasks(tasks), [tasks])
  const openCount = tasks.filter((t) => !t.done).length
  const doneCount = tasks.filter((t) => t.done).length
  const isEmpty = messages.length === 0

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Jarvis</h1>
        <span className="app__subtitle">Sohbetle Todo</span>
        {models.length > 0 && (
          <select
            className="app__model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={loading}
            title="Gemini modeli"
            aria-label="Gemini modeli"
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
        <span className="app__counter">
          {openCount} açık · {doneCount} bitti
        </span>
      </header>

      <section className="tasks" aria-label="Görevler">
        {tasks.length === 0 ? (
          <p className="tasks__empty">Henüz görev yok.</p>
        ) : (
          groups.map((g) => (
            <div key={g.name ?? '__none__'} className="group">
              {g.name && <h2 className="group__title">{g.name}</h2>}
              <ul className="tasks__list">
                {g.tasks.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <main className="chat">
        {isEmpty && !loading ? (
          <div className="chat__empty">
            <p>Bir şeyler yaz — ne yapman gerektiğini söyle.</p>
            <p className="chat__hint">
              Örn: "market alışverişi: süt, ekmek, yumurta" · "bitirdim süt" · "rapor" (gün sonu özeti).
            </p>
          </div>
        ) : (
          <ul className="chat__list">
            {messages.map((m) => (
              <li key={m.id} className={`msg msg--${m.role}`}>
                <div className="msg__bubble">{m.text}</div>
              </li>
            ))}
            {loading && (
              <li className="msg msg--assistant">
                <div className="msg__bubble msg__bubble--pending">yazıyor…</div>
              </li>
            )}
          </ul>
        )}
        <div ref={listEndRef} />
      </main>

      {error && <div className="chat__error">{error}</div>}

      <form className="composer" onSubmit={handleSubmit}>
        <input
          className="composer__input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Mesajını yaz…"
          autoComplete="off"
          disabled={loading}
        />
        <button className="composer__send" type="submit" disabled={loading || !input.trim()}>
          Gönder
        </button>
      </form>
    </div>
  )
}
