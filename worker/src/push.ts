import { buildPushHTTPRequest } from '@pushforge/builder'

/**
 * Web Push abonelik saklama (KV) + gönderim (@pushforge/builder — kenar-uyumlu, Web Crypto).
 * Abonelikler cihaz başına `sub:<endpoint-hash>` anahtarında tutulur.
 * VAPID özel anahtarı yalnızca Worker secret'ında (VAPID_PRIVATE_KEY, JWK) durur.
 */

export interface PushSub {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface PushPayload {
  title: string
  body: string
  taskId?: string
}

interface PushEnv {
  VAPID_PRIVATE_KEY?: string // JWK (secret)
  VAPID_SUBJECT?: string // mailto:...
}

const PREFIX = 'sub:'

/** Endpoint'ten kısa, kararlı anahtar (SHA-256'nın ilk 16 baytı → 32 hex). */
async function endpointKey(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))
  const bytes = new Uint8Array(digest)
  let hex = ''
  for (let i = 0; i < 16; i++) hex += bytes[i].toString(16).padStart(2, '0')
  return PREFIX + hex
}

/** Gelen değerin geçerli bir abonelik olduğunu doğrula. */
export function isValidSub(v: unknown): v is PushSub {
  const s = v as PushSub
  return (
    !!s &&
    typeof s.endpoint === 'string' &&
    /^https:\/\//.test(s.endpoint) &&
    !!s.keys &&
    typeof s.keys.p256dh === 'string' &&
    typeof s.keys.auth === 'string'
  )
}

export async function saveSubscription(kv: KVNamespace, sub: PushSub): Promise<void> {
  await kv.put(await endpointKey(sub.endpoint), JSON.stringify(sub))
}

export async function listSubscriptions(
  kv: KVNamespace,
): Promise<Array<{ key: string; sub: PushSub }>> {
  const out: Array<{ key: string; sub: PushSub }> = []
  let cursor: string | undefined
  do {
    const res = await kv.list({ prefix: PREFIX, cursor })
    for (const k of res.keys) {
      const sub = (await kv.get(k.name, 'json')) as PushSub | null
      if (sub) out.push({ key: k.name, sub })
    }
    cursor = res.list_complete ? undefined : res.cursor
  } while (cursor)
  return out
}

export async function deleteSubscription(kv: KVNamespace, key: string): Promise<void> {
  await kv.delete(key)
}

/**
 * Bir aboneliğe push gönderir. Dönüş: push servisinin HTTP durum kodu (ağ hatasında 0).
 * 404/410 → abonelik ölü (çağıran KV'den silmeli).
 */
export async function sendPush(env: PushEnv, sub: PushSub, payload: PushPayload): Promise<number> {
  const privateJWK = env.VAPID_PRIVATE_KEY
  if (!privateJWK) throw new Error('VAPID_PRIVATE_KEY tanımlı değil')

  // Jsonifiable'ı karşılamak için düz string map (undefined alanları dışarıda bırak).
  const msgPayload: Record<string, string> = { title: payload.title, body: payload.body }
  if (payload.taskId) msgPayload.taskId = payload.taskId

  const { endpoint, body, headers } = await buildPushHTTPRequest({
    privateJWK,
    subscription: sub,
    message: {
      payload: msgPayload, // JSON olarak şifrelenir → SW event.data.json()
      adminContact: env.VAPID_SUBJECT || 'mailto:admin@example.com',
      options: { ttl: 86400, urgency: 'high' },
    },
  })

  try {
    const res = await fetch(endpoint, { method: 'POST', headers, body })
    return res.status
  } catch {
    return 0
  }
}
