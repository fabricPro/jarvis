# Jarvis — Sohbetle Todo Asistanı

Cloudflare üstünde çalışan kişisel bir "sohbetle todo" asistanı.

- **Frontend:** React + Vite PWA → Cloudflare Pages (`frontend/`)
- **Backend/API:** tek bir Cloudflare Worker (`worker/`)
- **Veri:** Cloudflare KV
- **Model:** Google Gemini Flash — API anahtarı Worker'da **secret** olarak durur,
  frontend'e asla düşmez.

> Durum: **Gemini reducer + gruplama/alt görev + deterministik rapor + deploy akışı.**
> `GEMINI_API_KEY` tanımlıysa `/api/chat` mesajı Gemini'ye gönderir, güncel görev listesi JSON
> olarak döner ve KV'ye yazılır. Anahtar **yoksa** deterministik bir fallback reducer devreye
> girer. `"rapor"` komutu Worker'da deterministik olarak üretilir. Dağıtım için bkz. [DEPLOY.md](./DEPLOY.md).

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

## Deploy

Cloudflare'e dağıtım (Worker + Pages, cross-origin + CORS) için adım adım runbook:
**[DEPLOY.md](./DEPLOY.md)**.

Kısa özet (kökten):

```bash
npx wrangler login
# worker/wrangler.jsonc içine gerçek KV id'lerini yaz (bkz. DEPLOY.md #1)
cd worker && npx wrangler secret put GEMINI_API_KEY && cd ..

npm run deploy:api     # Worker → *.workers.dev
npm run deploy:web     # Pages → *.pages.dev  (API tabanı frontend/.env.production'dan gelir)
```

> Frontend'in konuştuğu Worker URL'i `frontend/.env.production` içindedir; URL değişirse
> orayı güncelle. Böylece `deploy:web` için env değişkeni ayarlamak gerekmez (cmd/PowerShell farkı yok).

**İki erişim adresi:** `deploy:api` frontend'i Worker'a da paketler (Workers Static Assets),
böylece uygulama hem Pages'ten (`*.pages.dev`) hem de Worker'ın kendisinden
(`https://jarvis-api.<sub>.workers.dev/`) açılır. Ağınız `*.pages.dev`'i engelliyorsa
workers.dev adresini kullanın (aynı origin, CORS gerekmez).

### Gemini yapılandırması

`/api/chat` reducer'ı `GEMINI_API_KEY` **tanımlıysa** Gemini Flash'ı kullanır; tanımlı
değilse deterministik fallback reducer çalışır (basit ekle / "bitirdim X" / "rapor").

### Şifre koruması (opsiyonel)

`APP_PASSWORD` secret'ı ayarlıysa arayüz kilitlidir: kullanıcı şifreyle girer ve her API
isteği `x-app-password` header'ı taşır (`/api/health` hariç), yanlışsa **401**. Ayarlı
değilse auth kapalıdır (lokal/dev). Şifre yalnızca Worker'da doğrulanır, bundle'a girmez.

```bash
cd worker && npx wrangler secret put APP_PASSWORD
```

Lokal geliştirmede secret'lar `worker/.dev.vars` içine konur (git'e girmez):

```
GEMINI_API_KEY="..."
APP_PASSWORD="..."                          # arayüz şifresi (opsiyonel)
# opsiyonel:
# GEMINI_MODEL="gemini-3.5-flash"          # varsayılan: gemini-3.5-flash
# GEMINI_BASE_URL="https://..."            # varsayılan: Google Generative Language API
```

`GEMINI_BASE_URL` yalnızca test (mock sunucu) veya self-host/proxy senaryoları içindir;
normalde ayarlanmaz. API anahtarı yalnızca Worker `env` üzerinden okunur, frontend'e düşmez.
