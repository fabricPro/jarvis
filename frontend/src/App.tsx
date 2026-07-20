import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { sendChat } from './api'
import type { ChatMessage } from './types'

function newId(): string {
  return crypto.randomUUID()
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const listEndRef = useRef<HTMLDivElement>(null)

  // Yeni mesaj geldikçe en alta kaydır.
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading) return

    const userMsg: ChatMessage = { id: newId(), role: 'user', text }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setError(null)
    setLoading(true)

    try {
      const reply = await sendChat(text)
      setMessages((prev) => [...prev, { id: newId(), role: 'assistant', text: reply }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bilinmeyen bir hata oluştu.')
    } finally {
      setLoading(false)
    }
  }

  const isEmpty = messages.length === 0

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Jarvis</h1>
        <span className="app__subtitle">Sohbetle Todo</span>
      </header>

      <main className="chat">
        {isEmpty && !loading ? (
          <div className="chat__empty">
            <p>Bir şeyler yaz — ne yapman gerektiğini söyle.</p>
            <p className="chat__hint">
              Not: Gemini henüz bağlı değil, asistan şimdilik sahte yanıt döner.
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
