import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Yapı zamanı damgası — kullanıcı canlı sürümü tek bakışta görür (deploy ulaştı mı?).
  define: {
    __BUILD_ID__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')),
  },
  plugins: [
    react(),
    VitePWA({
      // Web Push için AKTİF, elle yazılmış service worker (frontend/src/sw.js).
      // Bayatlamayı önlemek için: install→skipWaiting, activate→clients.claim + sürümlü
      // cache temizliği, /api ve navigasyonda network-first, statiklerde cache-first (bkz. sw.js).
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectRegister: 'auto',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
      },
      devOptions: { enabled: true, type: 'module' },
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'jarvis_icon.svg'],
      manifest: {
        name: 'Jarvis — Sohbetle Todo',
        short_name: 'Jarvis',
        description: 'Kişisel sohbetle todo asistanı',
        lang: 'tr',
        theme_color: '#151310',
        background_color: '#151310',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'favicon.png', sizes: '32x32', type: 'image/png', purpose: 'any' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    // Lokal geliştirmede /api istekleri wrangler dev'e (Worker) proxy'lenir.
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
