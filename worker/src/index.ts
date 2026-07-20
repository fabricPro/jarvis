/**
 * Jarvis API — Cloudflare Worker
 *
 * Adım 4 (Gemini): /api/chat mesajı okur → reducer → KV'ye yazar.
 *   - GEMINI_API_KEY tanımlıysa reducer Gemini Flash'tır (grup + alt görev).
 *   - Tanımlı değilse deterministik fallback reducer devreye girer (anahtarsız dev için).
 * API anahtarı yalnızca Worker env'inde durur; frontend'e asla düşmez.
 */

import { geminiReduce } from './gemini'
import { reduce } from './reducer'
import { buildReport, isReportCommand } from './report'
import { getState, putState } from './store'

export interface Env {
  // Görev durumunu tutan KV namespace'i.
  TASKS_KV: KVNamespace
  // Gemini (opsiyonel — secret olarak eklenir; yoksa deterministik fallback çalışır).
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
  GEMINI_BASE_URL?: string
  // Rapor için yerel saat dilimi (opsiyonel; varsayılan Europe/Istanbul).
  REPORT_TZ?: string
}

interface ChatRequest {
  message: string
}

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...init?.headers,
    },
  })
}

async function handleChat(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, { status: 405 })
  }

  let body: ChatRequest
  try {
    body = (await request.json()) as ChatRequest
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 })
  }

  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  if (!message) {
    return json({ error: 'empty_message', message: 'Mesaj boş olamaz.' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const prev = await getState(env.TASKS_KV, now)

  // "rapor" → deterministik rapor; Gemini'ye gitmez, durumu değiştirmez, KV yazılmaz.
  if (isReportCommand(message)) {
    return json({ reply: buildReport(prev, now, env.REPORT_TZ), state: prev })
  }

  let result
  if (env.GEMINI_API_KEY) {
    // Gemini yolu — hata olursa durumu değiştirmeden 502 dön.
    try {
      result = await geminiReduce(env, prev, message, now)
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'bilinmeyen hata'
      return json(
        { error: 'gemini_failed', message: `Gemini yanıt veremedi: ${detail}` },
        { status: 502 },
      )
    }
  } else {
    // Anahtar yok — deterministik fallback.
    result = reduce(prev, message, now)
  }

  await putState(env.TASKS_KV, result.state)
  return json({ reply: result.reply, state: result.state })
}

async function handleState(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, { status: 405 })
  }
  const now = new Date().toISOString()
  const state = await getState(env.TASKS_KV, now)
  return json({ state })
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // GET /api/health → sağlık kontrolü
    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json({ ok: true })
    }

    // GET /api/state → mevcut görev durumu
    if (url.pathname === '/api/state') {
      return handleState(request, env)
    }

    // /api/chat → mesajı işle, durumu güncelle
    if (url.pathname === '/api/chat') {
      return handleChat(request, env)
    }

    return json({ error: 'not_found' }, { status: 404 })
  },
} satisfies ExportedHandler<Env>
