interface ChatResponse {
  reply: string
}

/**
 * Worker'ın /api/chat uç noktasına mesaj gönderir ve asistan yanıtını döndürür.
 * (Lokal geliştirmede /api istekleri Vite proxy'si üzerinden Worker'a gider.)
 */
export async function sendChat(message: string): Promise<string> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  })

  if (!res.ok) {
    let detail = ''
    try {
      const data = (await res.json()) as { message?: string; error?: string }
      detail = data.message ?? data.error ?? ''
    } catch {
      // yanıt gövdesi JSON değilse yoksay
    }
    throw new Error(detail || `İstek başarısız (HTTP ${res.status})`)
  }

  const data = (await res.json()) as ChatResponse
  return data.reply
}
