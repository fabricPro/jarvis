/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Prod'da Worker API'sinin mutlak tabanı (örn. https://jarvis-api.xxx.workers.dev). Dev'de boş. */
  readonly VITE_API_BASE?: string
  /** Web Push VAPID public anahtarı (base64url, gizli değil). */
  readonly VITE_VAPID_PUBLIC_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Build sırasında vite.config.ts `define` ile gömülen yapı zamanı damgası. */
declare const __BUILD_ID__: string
