import { reconcile, type ModelTask } from './reconcile'
import type { ReduceResult } from './reducer'
import type { TaskState } from './types'

/**
 * Gemini Flash tabanlı reducer.
 *
 * Mevcut görev durumu + kullanıcı mesajı Gemini'ye gönderilir; Gemini güncel görev
 * listesini yapılandırılmış JSON olarak döndürür. Worker id/timestamp'leri reconcile eder.
 *
 * API anahtarı yalnızca Worker env'inde durur; asla frontend'e düşmez.
 */

interface GeminiEnv {
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
  GEMINI_BASE_URL?: string
}

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com'
const DEFAULT_MODEL = 'gemini-2.0-flash'

const SYSTEM_INSTRUCTION = `Sen kişisel bir "sohbetle todo" asistanının görev reducer'ısın.
Sana mevcut görev durumu (JSON) ve kullanıcının serbest metin mesajı verilir.
Görevin: mesaja göre GÜNCEL ve TAM görev listesini üretmek.

Kurallar:
- Türkçe yanıt ver.
- Mevcut görevlerin ve alt görevlerin "id" alanlarını AYNEN koru; başlığı değişmeyeni değiştirme.
- İlgili görevleri mantıklı "group" değerleriyle grupla (örn. "Alışveriş", "İş", "Ev").
- Uygun olduğunda görevi "subtasks" ile alt adımlara böl.
- Kullanıcı bir şeyi bitirdiğini söylerse ("bitirdim", "tamamladım", "yaptım") ilgili görevi
  veya alt görevi done=true yap.
- Kullanıcı "rapor" isterse görev listesini DEĞİŞTİRME; sadece "reply" alanında kısa bir
  gün sonu özeti ver.
- Yeni eklenen görev/alt görevlerde "id" alanını boş bırak (id'yi sistem atar).
- "reply" kısa, doğal ve samimi olsun.`

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    finishReason?: string
  }>
  promptFeedback?: { blockReason?: string }
}

interface ModelOutput {
  reply: string
  tasks: ModelTask[]
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reply: { type: 'STRING' },
    tasks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          title: { type: 'STRING' },
          group: { type: 'STRING' },
          done: { type: 'BOOLEAN' },
          subtasks: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                id: { type: 'STRING' },
                title: { type: 'STRING' },
                done: { type: 'BOOLEAN' },
              },
              required: ['title', 'done'],
            },
          },
        },
        required: ['title', 'done'],
      },
    },
  },
  required: ['reply', 'tasks'],
}

/** Gemini'ye gönderilecek kompakt durum görünümü (timestamp'ler hariç). */
function stateForPrompt(state: TaskState) {
  return {
    tasks: state.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      group: t.group,
      done: t.done,
      subtasks: t.subtasks.map((s) => ({ id: s.id, title: s.title, done: s.done })),
    })),
  }
}

export async function geminiReduce(
  env: GeminiEnv,
  prev: TaskState,
  message: string,
  now: string,
): Promise<ReduceResult> {
  const apiKey = env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY tanımlı değil')

  const baseUrl = (env.GEMINI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const model = env.GEMINI_MODEL || DEFAULT_MODEL
  const url = `${baseUrl}/v1beta/models/${model}:generateContent`

  const userText = [
    'Mevcut durum:',
    JSON.stringify(stateForPrompt(prev)),
    '',
    `Kullanıcı mesajı: ${message}`,
  ].join('\n')

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.2,
      },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Gemini isteği başarısız (HTTP ${res.status}): ${body.slice(0, 300)}`)
  }

  const data = (await res.json()) as GeminiResponse

  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini içeriği engelledi: ${data.promptFeedback.blockReason}`)
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini boş yanıt döndürdü')

  let output: ModelOutput
  try {
    output = JSON.parse(text) as ModelOutput
  } catch {
    throw new Error('Gemini yanıtı JSON olarak ayrıştırılamadı')
  }

  if (!Array.isArray(output.tasks)) {
    throw new Error('Gemini yanıtında tasks dizisi yok')
  }

  const state = reconcile(prev, output.tasks, now)
  const reply = typeof output.reply === 'string' ? output.reply : 'Tamam.'
  return { state, reply }
}
