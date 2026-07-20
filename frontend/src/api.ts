import type { TaskState } from './types'

// Prod'da Worker ayrı bir origin'dedir (*.workers.dev). Build sırasında VITE_API_BASE ile
// Worker'ın mutlak URL'i verilir. Boşsa (dev) relative kalır ve Vite proxy'si /api'yi Worker'a yönlendirir.
const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '')

interface ChatResponse {
  reply: string
  state: TaskState
}

interface StateResponse {
  state: TaskState
}

export interface ModelsInfo {
  models: string[]
  default: string
}

async function parseError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string; error?: string }
    return data.message ?? data.error ?? ''
  } catch {
    return ''
  }
}

/**
 * Worker'ın /api/chat uç noktasına mesaj gönderir; asistan yanıtını ve güncel durumu döndürür.
 * (Lokal geliştirmede /api istekleri Vite proxy'si üzerinden Worker'a gider.)
 */
export async function sendChat(message: string, model?: string): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, model }),
  })
  if (!res.ok) {
    const detail = await parseError(res)
    throw new Error(detail || `İstek başarısız (HTTP ${res.status})`)
  }
  return (await res.json()) as ChatResponse
}

/** Sayfa açılışında mevcut görev durumunu çeker. */
export async function fetchState(): Promise<TaskState> {
  const res = await fetch(`${API_BASE}/api/state`)
  if (!res.ok) {
    const detail = await parseError(res)
    throw new Error(detail || `Durum alınamadı (HTTP ${res.status})`)
  }
  const data = (await res.json()) as StateResponse
  return data.state
}

/** Seçilebilir Gemini modelleri ve varsayılan. */
export async function fetchModels(): Promise<ModelsInfo> {
  const res = await fetch(`${API_BASE}/api/models`)
  if (!res.ok) {
    const detail = await parseError(res)
    throw new Error(detail || `Modeller alınamadı (HTTP ${res.status})`)
  }
  return (await res.json()) as ModelsInfo
}
