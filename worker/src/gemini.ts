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

/** Varsayılan model ve kullanıcının UI'dan seçebileceği modeller (allowlist). */
export const DEFAULT_MODEL = 'gemini-3.5-flash'
export const MODEL_OPTIONS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite']

/** Seçilebilir model listesi ve varsayılan. env.GEMINI_MODEL varsa varsayılan odur ve listeye eklenir. */
export function resolveModels(env: GeminiEnv): { models: string[]; default: string } {
  const def = env.GEMINI_MODEL?.trim() || DEFAULT_MODEL
  const models = Array.from(new Set([def, ...MODEL_OPTIONS]))
  return { models, default: def }
}

const SYSTEM_INSTRUCTION = `Sen JARVIS'sin — Devoretex AR-GE ekibinin sakin, kesin, öngörülü kişisel görev
asistanısın (Iron Man'deki gibi). Sana mevcut görev durumu (JSON) ve kullanıcının
serbest Türkçe mesajı verilir. Görevin: GÜNCEL ve TAM görev listesini üretmek.

Kurallar:
- Türkçe yanıt ver.
- Mevcut görev ve alt görevlerin "id" alanlarını AYNEN koru; değişmeyen başlığı değiştirme.
- Yeni görev/alt görevlerde "id" alanını boş bırak (id'yi sistem atar).
- Kullanıcı bitirdiğini söylerse ("bitirdim/yaptım/tamam") ilgili görevi/alt görevi done=true yap.
- Uygun olduğunda görevi 2-4 somut adıma "subtasks" ile böl. Basit tek işi BÖLME.

## Gruplama ("group" alanı)
- Her göreve AZ sayıda tutarlı gruptan birini ver. Amaç düzen; grup enflasyonu değil.
- ÖNCE mevcut görevlerdeki "group" değerlerine bak. Uygun grup varsa AYNI yazımı kullan.
  Var olan grup adlarını değiştirme; yenisini ancak hiçbiri uymuyorsa aç.
- Grup adlarını mümkünse şu kümeden seç:
  "AR-GE / Numune", "Üretim / Tezgah", "Tedarik / İplik", "Müşteri / İhracat", "İdari / Ofis", "Kişisel"

## Alan sözlüğü (grup seçerken kullan)
- numune, desen, armür, dobby, çözgü, atkı, WIF, leno, gramaj, Tezgah, FAS, NDP -> AR-GE / Numune
  (işin özü dokuma/tezgah ayarıysa: Üretim / Tezgah)
- iplik, tedarikçi, iplik siparişi, boya, hammadde        -> Tedarik / İplik
- müşteri, teklif, ihracat, numune sevki, koleksiyon, fuar -> Müşteri / İhracat
- fatura, toplantı, sunum, rapor, evrak                   -> İdari / Ofis
- ev, market, çamaşır, sağlık                             -> Kişisel

## Alt görevler
- Alana uygun, gerçekçi adımlar. Emin değilsen az ve genel tut; UYDURMA.
- Örnek: "X'e perdelik numune hazırla" -> çözgü/atkı ve deseni netleştir · tezgah ayarı ·
  dokut · gramaj/kalite kontrol · paketle ve sevk et.

## Yanıt (reply)
- JARVIS tonunda: sakin, kesin, 1-2 cümle. Gerektiğinde "Efendim" — ölçülü. Listeyi tekrar sayma.`

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
  model: string,
  history: string[] = [],
): Promise<ReduceResult> {
  const apiKey = env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY tanımlı değil')

  const baseUrl = (env.GEMINI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const url = `${baseUrl}/v1beta/models/${model}:generateContent`

  const parts: string[] = ['Mevcut durum:', JSON.stringify(stateForPrompt(prev))]
  if (history.length > 0) {
    parts.push('', 'Son konuşma:', ...history.slice(-6))
  }
  parts.push('', `Kullanıcı mesajı: ${message}`)
  const userText = parts.join('\n')

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
