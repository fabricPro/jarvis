/**
 * Jarvis API — Cloudflare Worker
 *
 * Adım 2 (sohbet akışı): /api/chat artık POST kabul eder ve SAHTE (mock) bir
 * asistan yanıtı döndürür. Reducer + Gemini + KV yazımı sonraki adımlarda gelecek.
 */

export interface Env {
  // Görev durumunu tutacak KV namespace'i (henüz kullanılmıyor).
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

async function handleChat(request: Request): Promise<Response> {
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

  // SAHTE yanıt — gerçek reducer/Gemini ileride burada devreye girecek.
  const reply =
    `Mesajını aldım: "${message}". ` +
    'Şu an sahte (mock) yanıt dönüyorum — Gemini entegrasyonu henüz eklenmedi.'

  return json({ reply })
}

export default {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // GET /api/health → sağlık kontrolü
    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json({ ok: true })
    }

    // /api/chat → sohbet (şimdilik mock)
    if (url.pathname === '/api/chat') {
      return handleChat(request)
    }

    return json({ error: 'not_found' }, { status: 404 })
  },
} satisfies ExportedHandler<Env>
