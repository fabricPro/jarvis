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
      // Bayat önbellek sorununu kökten bitirmek için service worker'ı kendini imha eden
      // moda alıyoruz: mevcut SW kaydını siler + önbelleklerini temizler, uygulama her
      // yüklemede taze gelir (uygulama sunucu-tabanlı; çevrimdışı fayda sağlamıyordu).
      selfDestroying: true,
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
