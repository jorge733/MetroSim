/* ==========================================================================
   MetroSim — 1.5 · sw.js
   Service worker de la PWA: permite instalar RedMoviSim y jugar sin conexión.

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

const CACHE = "metrosim-v2.24.2";
const CDN = ["cdn.jsdelivr.net", "unpkg.com"];

/** Lo mínimo para que la portada abra sin conexión aunque no se haya jugado. */
const SHELL = [
  "./", "index.html", "styles.css", "css/ui.css", "css/home.css", "css/game.css", "css/bus.css", "logo.svg", "favicon.svg",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/bip.png",
  "js/boot.js", "js/mantencion.js", "js/cuenta.js", "js/sugerencias.js", "js/main.js",
  // Fuentes de la interfaz (si faltan, la portada usa letras del sistema)
  "fonts/barlow-latin-400-normal.woff2", "fonts/barlow-latin-500-normal.woff2",
  "fonts/barlow-latin-600-normal.woff2", "fonts/barlow-latin-700-normal.woff2",
  "fonts/barlow-condensed-latin-600-normal.woff2", "fonts/barlow-condensed-latin-700-normal.woff2",
  "fonts/jetbrains-mono-latin-500-normal.woff2", "fonts/jetbrains-mono-latin-700-normal.woff2",
];

/** 2.16.3 · Three.js y lo demás del CDN (mismas URL que el importmap de index.html). */
const CDN_FILES = [
  "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js",
  "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/environments/RoomEnvironment.js",
  "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/utils/BufferGeometryUtils.js",
  "https://unpkg.com/es-module-shims@1.10.0/dist/es-module-shims.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    // 2.16.3 · Todos los módulos del juego, siguiendo sus import desde boot.js (antes solo se guardaban 5 y, sin
    // conexión, la primera visita quedaba en negro). Si algo falla, se instala igual: el resto se guarda al usarlo.
    await crawl(cache, ["js/boot.js", "js/main.js", ...CDN_FILES]).catch(() => {});
    await self.skipWaiting();
  })());
});

/** import … from "./x.js", import "./x.js" e import("./x.js"): solo rutas relativas (las de «three» van en CDN_FILES). */
const IMPORT_RE = /\b(?:import|export)\s[^;"'`]*?\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s*["']([^"']+)["']/g;
async function crawl(cache, entries) {
  const seen = new Set(), queue = entries.map(u => new URL(u, self.registration.scope).href);
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const own = new URL(url).origin === self.location.origin;
      if (!own && await cache.match(url)) continue;
      const res = await fetch(url, own ? { cache: "no-cache" } : { mode: "cors" });
      if (!res.ok) continue;
      await cache.put(url, res.clone());
      if (!/\.m?js$/.test(new URL(url).pathname)) continue;
      for (const m of (await res.text()).matchAll(IMPORT_RE)) {
        const spec = m[1] || m[2] || m[3];
        if (spec.startsWith(".")) queue.push(new URL(spec, url).href);
      }
    } catch { /* sin red o archivo que no está: se sigue con los demás */ }
  }
}

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
    // no-cache: siempre se pregunta al servidor si hay versión nueva (la caché HTTP podía
    // entregar un archivo viejo varios minutos y dos jugadores quedaban con versiones distintas)
    const res = await fetch(req, { cache: "no-cache" });
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
