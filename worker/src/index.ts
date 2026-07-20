/**
 * Jarvis API — Cloudflare Worker
 *
 * Adım 3 (KV): görev durumu KV'de tutulur. /api/chat mesajı okur → reducer → KV'ye yazar.
 * Reducer şimdilik deterministik bir PLACEHOLDER; Gemini entegrasyonu sonraki adımda gelecek.
 */

import { reduce } from './reducer'
import { getState, putState } from './store'

export interface Env {
  // Görev durumunu tutan KV namespace'i.
  TASKS_KV: KVNamespace
  // GEMINI_API_KEY: string   // ileride secret olarak eklenecek
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
  const { state, reply } = reduce(prev, message, now)
  await putState(env.TASKS_KV, state)

  return json({ reply, state })
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
