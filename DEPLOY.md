# Deploy — Jarvis

Cloudflare'e dağıtım: **Worker** (API) + **Pages** (frontend). İki ayrı origin; frontend,
Worker'ın mutlak URL'ine cross-origin istek atar (CORS Worker'da açık).

Ön koşullar:
- Cloudflare hesabı
- `npm install` yapılmış olmalı
- Giriş: `npx wrangler login`

---

## 1) KV namespace oluştur

```bash
cd worker
npx wrangler kv namespace create TASKS_KV
npx wrangler kv namespace create TASKS_KV --preview
```

Dönen `id` ve `preview_id` değerlerini `worker/wrangler.jsonc` içindeki `kv_namespaces`
bloğuna yaz (`REPLACE_WITH_...` yerlerine).

## 2) Gemini secret'ını ekle

```bash
cd worker
npx wrangler secret put GEMINI_API_KEY
# (opsiyonel model/tz için wrangler.jsonc > vars kullanılabilir)
```

> Anahtar yoksa Worker deterministik fallback reducer ile çalışır; yine de deploy edilebilir.

Arayüzü şifreyle korumak için (opsiyonel, önerilir):

```bash
cd worker
npx wrangler secret put APP_PASSWORD
```

> Ayarlıysa arayüz kilitlenir ve her API isteği doğru `x-app-password` header'ı ister
> (`/api/health` hariç), yanlışsa 401.

## 3) Worker'ı deploy et

Kökten:

```bash
npm run deploy:api
```

Çıktıdaki Worker URL'ini not et, örn. `https://jarvis-api.<subdomain>.workers.dev`.

Sağlık kontrolü:

```bash
curl https://jarvis-api.<subdomain>.workers.dev/api/health   # {"ok":true}
```

## 4) Pages projesi (ilk sefer)

Production branch'i açıkça `main` ver (interaktif istemde yanlış değer girmemek için):

```bash
npx wrangler pages project create jarvis --production-branch main
```

`deploy:web` her zaman `--branch main` ile deploy ettiği için deployment'lar production sayılır.

## 5) Frontend'i build edip deploy et

Worker URL'ini build değişkeni olarak vererek deploy et (kökten):

```bash
# Linux/macOS:
VITE_API_BASE="https://jarvis-api.<subdomain>.workers.dev" npm run deploy:web

# Windows cmd (iki ayrı satır):
set VITE_API_BASE=https://jarvis-api.<subdomain>.workers.dev
npm run deploy:web

# Windows PowerShell:
$env:VITE_API_BASE="https://jarvis-api.<subdomain>.workers.dev"; npm run deploy:web
```

Bu, `VITE_API_BASE` ile build alır (frontend Worker'a bu URL üzerinden gider) ve
`frontend/dist`'i Pages'e yükler. Çıktıdaki Pages URL'ini not et, örn.
`https://jarvis.pages.dev`.

## 6) CORS'u daralt (önerilir)

`worker/wrangler.jsonc` içindeki `vars.CORS_ORIGIN` değerini Pages URL'ine ayarla:

```jsonc
"vars": { "CORS_ORIGIN": "https://jarvis.pages.dev" }
```

Sonra Worker'ı yeniden deploy et:

```bash
npm run deploy:api
```

---

## Güncelleme akışı

- Sadece API değişti → `npm run deploy:api`
- Sadece frontend değişti → `VITE_API_BASE="https://jarvis-api...workers.dev" npm run deploy:web`

## Notlar

- `GEMINI_API_KEY` yalnızca Worker secret'ıdır; frontend build'ine **girmez**.
- `VITE_API_BASE` boş bırakılırsa (lokal `npm run dev:web`) istekler relative kalır ve
  Vite proxy'si `/api`'yi lokal Worker'a (`wrangler dev`, :8787) yönlendirir.
- Preview KV (`preview_id`) yalnızca `wrangler dev --remote` ve preview dağıtımları içindir;
  yerel `wrangler dev` diske yazan yerel bir simülasyon kullanır.
