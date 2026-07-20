# Jarvis — Sohbetle Todo Asistanı

Cloudflare üstünde çalışan kişisel bir "sohbetle todo" asistanı.

- **Frontend:** React + Vite PWA → Cloudflare Pages (`frontend/`)
- **Backend/API:** tek bir Cloudflare Worker (`worker/`)
- **Veri:** Cloudflare KV
- **Model:** Google Gemini Flash — API anahtarı Worker'da **secret** olarak durur,
  frontend'e asla düşmez.

> Durum: **Adım 4 — Gemini reducer + gruplama/alt görev.** `GEMINI_API_KEY` tanımlıysa
> `/api/chat` mesajı Gemini'ye gönderir, güncel görev listesi JSON olarak döner ve KV'ye yazılır.
> Anahtar **yoksa** deterministik bir fallback reducer devreye girer (anahtarsız geliştirme için).

## Yapı

```
.
├── frontend/   # Vite + React + TS PWA
└── worker/     # Cloudflare Worker (API)
```

npm workspaces kullanılır; bağımlılıklar kökten kurulur.

## Kurulum

```bash
npm install
```

## Geliştirme

İki ayrı terminalde:

```bash
npm run dev:api   # Worker → http://localhost:8787
npm run dev:web   # Vite → http://localhost:5173 (/api istekleri Worker'a proxy'lenir)
```

Sağlık kontrolü:

```bash
curl http://localhost:8787/api/health   # {"ok":true}
curl http://localhost:8787/api/chat     # 501 (henüz uygulanmadı)
```

## Tip kontrolü & build

```bash
npm run typecheck
npm run build     # frontend/dist üretilir (PWA manifesti + service worker dahil)
```

## Cloudflare kurulumu (ileriki adımlar)

Bu adımda gerçek kaynaklar oluşturulmaz; `worker/wrangler.jsonc` içinde KV binding'i
**placeholder** id ile durur. Dağıtımdan önce:

```bash
# KV namespace oluştur ve dönen id'leri wrangler.jsonc'a yaz
npx wrangler kv namespace create TASKS_KV
npx wrangler kv namespace create TASKS_KV --preview

# Gemini API anahtarını Worker secret'ı olarak ekle
npx wrangler secret put GEMINI_API_KEY
```

### Gemini yapılandırması

`/api/chat` reducer'ı `GEMINI_API_KEY` **tanımlıysa** Gemini Flash'ı kullanır; tanımlı
değilse deterministik fallback reducer çalışır (basit ekle / "bitirdim X" / "rapor").

Lokal geliştirmede secret'lar `worker/.dev.vars` içine konur (git'e girmez):

```
GEMINI_API_KEY="..."
# opsiyonel:
# GEMINI_MODEL="gemini-2.5-flash"          # varsayılan: gemini-2.0-flash
# GEMINI_BASE_URL="https://..."            # varsayılan: Google Generative Language API
```

`GEMINI_BASE_URL` yalnızca test (mock sunucu) veya self-host/proxy senaryoları içindir;
normalde ayarlanmaz. API anahtarı yalnızca Worker `env` üzerinden okunur, frontend'e düşmez.
