/**
 * Jarvis API — Cloudflare Worker
 *
 * Adım 1 (iskelet): yalnızca health-check ve stub bir /api/chat.
 * Reducer mantığı ve Gemini entegrasyonu sonraki adımlarda /api/chat içine gelecek.
 */

export interface Env {
  // Görev durumunu tutacak KV namespace'i (henüz kullanılmıyor).
  TASKS_KV: KVNamespace
  // GEMINI_API_KEY: string   // ileride secret olarak eklenecek
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

export default {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // GET /api/health → sağlık kontrolü
    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json({ ok: true })
    }

    // /api/chat → reducer + Gemini ileride gelecek
    if (url.pathname === '/api/chat') {
      return json(
        { error: 'not_implemented', message: 'Sohbet uç noktası henüz uygulanmadı.' },
        { status: 501 },
      )
    }

    return json({ error: 'not_found' }, { status: 404 })
  },
} satisfies ExportedHandler<Env>
