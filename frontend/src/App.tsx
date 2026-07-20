import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { fetchState, sendChat } from './api'
import type { ChatMessage, TaskState } from './types'

function newId(): string {
  return crypto.randomUUID()
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [taskState, setTaskState] = useState<TaskState | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const listEndRef = useRef<HTMLDivElement>(null)

  // Açılışta mevcut görev durumunu çek.
  useEffect(() => {
    fetchState()
      .then(setTaskState)
      .catch((err) => setError(err instanceof Error ? err.message : 'Durum alınamadı.'))
  }, [])

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
      const { reply, state } = await sendChat(text)
      setMessages((prev) => [...prev, { id: newId(), role: 'assistant', text: reply }])
      setTaskState(state)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bilinmeyen bir hata oluştu.')
    } finally {
      setLoading(false)
    }
  }

  const tasks = taskState?.tasks ?? []
  const openTasks = tasks.filter((t) => !t.done)
  const doneTasks = tasks.filter((t) => t.done)
  const isEmpty = messages.length === 0

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Jarvis</h1>
        <span className="app__subtitle">Sohbetle Todo</span>
        <span className="app__counter">
          {openTasks.length} açık · {doneTasks.length} bitti
        </span>
      </header>

      <section className="tasks" aria-label="Görevler">
        {tasks.length === 0 ? (
          <p className="tasks__empty">Henüz görev yok.</p>
        ) : (
          <ul className="tasks__list">
            {[...openTasks, ...doneTasks].map((t) => (
              <li key={t.id} className={`task ${t.done ? 'task--done' : ''}`}>
                <span className="task__mark">{t.done ? '✓' : '○'}</span>
                <span className="task__title">{t.title}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <main className="chat">
        {isEmpty && !loading ? (
          <div className="chat__empty">
            <p>Bir şeyler yaz — ne yapman gerektiğini söyle.</p>
            <p className="chat__hint">
              Örn: "süt al" · "bitirdim süt" · "rapor". Gemini henüz bağlı değil; görevler
              basit kurallarla işlenir ve KV'de saklanır.
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
