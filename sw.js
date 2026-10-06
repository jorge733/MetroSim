/* ==========================================================================
   MetroSim — 1.1 · sw.js
   Service worker de la PWA: permite instalar MetroSim y jugar sin conexión.

   Estrategia:
     · Archivos propios (HTML, CSS, js/, audio/, íconos): primero la RED y,
       si no hay conexión, la copia guardada. Así cada cambio del juego se ve
       al recargar (útil con Live Server) y nunca queda una versión vieja
       pegada en la caché.
     · Librerías del CDN (Three.js, es-module-shims): primero la CACHÉ, porque
       su URL lleva la versión y no cambian nunca.
   La primera visita con internet guarda todo lo que el juego carga (incluidas
   las voces de los anuncios, que se precargan al empezar); desde ahí funciona
   sin conexión.
   ========================================================================== */

const CACHE = "metrosim-v1.1";
const CDN = ["cdn.jsdelivr.net", "unpkg.com"];

/** Lo mínimo para que la portada abra sin conexión aunque no se haya jugado. */
const SHELL = [
  "./", "index.html", "styles.css", "logo.svg", "favicon.svg",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png",
  "js/main.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);   // cachés de versiones anteriores
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) e.respondWith(networkFirst(req));
  else if (CDN.includes(url.hostname)) e.respondWith(cacheFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(stripSearch(req), res.clone());
    return res;
  } catch {
    const hit = await cache.match(stripSearch(req)) || (req.mode === "navigate" ? await cache.match("index.html") : null);
    return hit || Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") cache.put(req, res.clone());
  return res;
}

/** Guarda sin "?…" para que "index.html?touch=1" use la misma copia sin conexión. */
function stripSearch(req) {
  const url = new URL(req.url);
  if (!url.search) return req;
  url.search = "";
  return new Request(url.href);
}
