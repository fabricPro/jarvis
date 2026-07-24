// @ts-nocheck
// JARVIS service worker (injectManifest).
// Web Push için AKTİF SW; ama bayatlamayı önleyen cache stratejisi:
// - install: skipWaiting + statikleri SÜRÜMLÜ cache'e precache
// - activate: clients.claim + eski jarvis-* cache'lerini sil
// - /api/*: network-first (önbelleğe alma → durum bayatlamaz)
// - navigation: network-first (online HTML hep taze), offline'da index.html
// - statik (hash'li): cache-first
// Push + notificationclick: Part 5'te doldurulacak.

const MANIFEST = self.__WB_MANIFEST || [];
const indexEntry = MANIFEST.find((e) => e.url === "index.html" || e.url.endsWith("/index.html"));
const CACHE = "jarvis-" + (indexEntry?.revision || "v1"); // her deploy'da index.html revision ile değişir
const PRECACHE_URLS = MANIFEST.map((e) => e.url);

self.addEventListener("install", (event) => {
  self.skipWaiting();
  // Tek tek precache: bir varlık başarısız olursa diğerleri yine de önbelleğe girsin
  // (addAll hepsi-ya-hiç; tek 404 tüm precache'i iptal ederdi).
  event.waitUntil(
    (async () => {
      const c = await caches.open(CACHE);
      await Promise.all(
        PRECACHE_URLS.map(async (u) => {
          try {
            const res = await fetch(new Request(u, { cache: "reload" }));
            if (res && res.ok) await c.put(u, res.clone());
          } catch (e) {
            /* yoksay */
          }
        })
      );
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("jarvis-") && k !== CACHE).map((k) => caches.delete(k))
      );
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // API: her zaman ağ; önbelleğe alma (görev durumu bayatlamasın).
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(req));
    return;
  }

  // Sayfa gezinmesi: network-first → online'da taze HTML; offline'da precache index.html.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => {
        const c = await caches.open(CACHE);
        return (await c.match("index.html")) || (await c.match("/index.html")) || Response.error();
      })
    );
    return;
  }

  // Statik varlıklar (içerik-hash'li): cache-first, sürümlü cache.
  event.respondWith(
    caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && res.ok && res.type === "basic") c.put(req, res.clone());
      return res;
    })
  );
});
