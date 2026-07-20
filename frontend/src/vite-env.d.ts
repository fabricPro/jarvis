/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Prod'da Worker API'sinin mutlak tabanı (örn. https://jarvis-api.xxx.workers.dev). Dev'de boş. */
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
