/* ==========================================================================
   RedMoviSim — 1.18 · tools/recorridos-red.mjs
   Genera js/bus/redRoutes.js con recorridos REALES de buses Red, a partir de
   la API pública de red.cl (la misma que usa «Conoce tu recorrido»):

     https://www.red.cl/restservice_v2/rest/conocerecorrido?codsint=<servicio>

   El juego no la llama en vivo (red.cl no permite pedirla desde otra página
   y el juego tiene que andar sin conexión): este script toma una «foto» y la
   deja como datos. Volver a correrlo actualiza paraderos y distancias.

   De cada recorrido (sentido ida) se toma un TRAMO jugable de 10 a 13
   paraderos seguidos (3,5 a 6,5 km), el que pasa por más estaciones de Metro
   del juego. Las distancias salen del trazado real (path) de la API.

   Uso:   node tools/recorridos-red.mjs            (escribe js/bus/redRoutes.js)
          node tools/recorridos-red.mjs --ver      (solo muestra lo que elegiría)
   Necesita curl (respeta el proxy del sistema).
   ========================================================================== */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { LINES } from "../js/engine/network.js";

/** Servicios que se incluyen y el color del letrero (color de la zona/troncal de Red). */
const SERVICES = [
  { cod: "210", color: "#d7262e" },   // Alameda · Estación Central ⇄ Puente Alto
  { cod: "385", color: "#d7262e" },   // Alameda · Villa Francia ⇄ Florida Center
  { cod: "403", color: "#d7262e" },   // Santa Ana · Centro · Providencia
  { cod: "401", color: "#d7262e" },   // Alameda poniente · Maipú ⇄ Las Condes
  { cod: "109", color: "#0f9d58" },   // Renca ⇄ Maipú · Quinta Normal, Estación Central
  { cod: "107", color: "#0f9d58" },   // Departamental · Cerrillos, Pedrero
  { cod: "211", color: "#f2a900" },   // Gran Avenida · La Cisterna, El Bosque
  { cod: "506", color: "#0093b3" },   // Maipú ⇄ Peñalolén por la Alameda
];

const MIN_STOPS = 10, MAX_STOPS = 13, MIN_LEN = 3500, MAX_LEN = 6500;

const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const title = (s) => s.toLowerCase().replace(/(^|[\s(/-])([a-záéíóúñü])/g, (m, a, b) => a + b.toUpperCase())
  .replace(/\b(De|Del|La|Las|Los|El|Y|E)\b/g, w => w.toLowerCase()).replace(/^./, c => c.toUpperCase())
  .replace(/O'h/g, "O'H").replace(/\bAvenida\b/g, "Av.");

/** Estaciones del juego por nombre normalizado → nombre exacto (el que usa la ciudad). */
const STATIONS = new Map();
for (const L of LINES) for (const st of L.stations) STATIONS.set(norm(st.name), st.name);
for (const L of LINES) for (const st of L.stations) if (st.short) STATIONS.set(norm(st.short), STATIONS.get(norm(st.short)) ?? st.name);

/** «Metro L1 y L2» según las líneas del juego que paran en la estación. */
function hintOf(metro) {
  const tags = LINES.filter(L => L.stations.some(st => st.name === metro))
    .map(L => L.id === "NOS" ? "Tren Nos" : L.id === "RAN" ? "Tren Rancagua" : `L${L.id}`);
  const metros = tags.filter(t => t.startsWith("L")), trenes = tags.filter(t => !t.startsWith("L"));
  const parts = [];
  if (metros.length) parts.push("Metro " + metros.join(metros.length > 1 ? " y " : ""));
  parts.push(...trenes);
  return parts.length ? parts.slice(0, -1).join(", ") + (parts.length > 1 ? " y " : "") + parts.at(-1) : null;
}

function metroOf(name) {
  const m = name.match(/metro\s+(.+)$/i);
  if (!m) return null;
  return STATIONS.get(norm(m[1])) ?? null;
}

/** Distancia en metros entre dos puntos [lat, lon] (aprox. plana: tramos cortos). */
function dist(a, b) {
  const k = Math.PI / 180, R = 6371000;
  const x = (b[1] - a[1]) * k * Math.cos((a[0] + b[0]) / 2 * k), y = (b[0] - a[0]) * k;
  return Math.hypot(x, y) * R;
}

/** Distancia a lo largo del trazado de cada paradero (proyectado al vértice más cercano, sin retroceder). */
function chainage(path, stops) {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + dist(path[i - 1], path[i]));
  let from = 0;
  return stops.map(p => {
    let best = from, bd = Infinity;
    for (let i = from; i < Math.min(path.length, from + 400); i++) {
      const d = dist(path[i], p.pos);
      if (d < bd) { bd = d; best = i; }
    }
    from = best;
    return cum[best];
  });
}

function fetchService(cod) {
  const out = execFileSync("curl", ["-sS", "-m", "30", `https://www.red.cl/restservice_v2/rest/conocerecorrido?codsint=${cod}`], { encoding: "utf8", maxBuffer: 1 << 26 });
  return JSON.parse(out);
}

function cleanName(raw, metro) {
  if (metro) return title(metro);
  const cross = crossStreet(raw);
  if (cross) return cross.length > 30 ? cross.slice(0, 29) + "…" : cross;   // el bus va por el eje: basta la calle que cruza
  const n = tidy(raw.replace(/^Parada\s*\d+\s*[-/]\s*/i, "").replace(/\s+esq\.?\s+/i, " / "));
  return n.length > 34 ? n.slice(0, 33) + "…" : n;
}
const tidy = (s) => s.replace(/\bAvenida\b/g, "Av.").replace(/\b(Av|Diag|Pje)\.(?=\S)/g, "$1. ").trim();
const crossStreet = (raw) => { const c = raw.match(/esq\.?\s+(.+)$/i)?.[1]; return c ? tidy(c) : null; };

function bestWindow(stops, s) {
  let best = null;
  for (let a = 0; a < stops.length; a++) {
    for (let n = MIN_STOPS; n <= MAX_STOPS && a + n <= stops.length; n++) {
      const len = s[a + n - 1] - s[a];
      if (len < MIN_LEN || len > MAX_LEN) continue;
      const win = stops.slice(a, a + n);
      const metros = new Set(win.map(p => metroOf(p.name)).filter(Boolean)).size;
      const ends = (metroOf(win[0].name) ? 0.6 : 0) + (metroOf(win.at(-1).name) ? 0.6 : 0);
      const score = metros + ends + n * 0.01;
      if (!best || score > best.score) best = { a, n, score, metros };
    }
  }
  return best;
}

function build({ cod, color }) {
  const d = fetchService(cod);
  const ida = d.ida;
  const stops = ida.paraderos;
  const s = chainage(ida.path, stops);
  const w = bestWindow(stops, s);
  if (!w || w.metros < 2) { console.warn(`${cod}: sin tramo con Metro, se omite`); return null; }
  const win = stops.slice(w.a, w.a + w.n);
  const s0 = s[w.a] - 40;                         // el primer paradero queda en s = 40, como el A01
  const routeStops = [], used = new Set();
  for (let i = 0; i < win.length; i++) {
    const p = win[i];
    let metro = metroOf(p.name);
    let name = cleanName(p.name, metro);
    if (metro && used.has(metro)) { name += " (salida 2)"; metro = null; }   // dos paraderos para la misma estación
    const st = { name, s: Math.round(s[w.a + i] - s0), code: p.cod };
    if (routeStops.length && st.s - routeStops.at(-1).s < 120) continue;   // paraderos pegados: uno basta en el juego
    if (metro) { st.metro = metro; used.add(metro); const h = hintOf(metro); if (h) st.hint = h; }
    routeStops.push(st);
  }
  while (routeStops.length > MIN_STOPS && routeStops.at(-1).name.endsWith("(salida 2)")) routeStops.pop();   // que termine en la estación
  // Semáforos: uno en el cruce entre cada par de paraderos (si hay espacio)
  const lights = [];
  for (let i = 0; i < routeStops.length - 1; i++) {
    const A = routeStops[i], B = routeStops[i + 1];
    if (B.s - A.s < 230) continue;
    const raw = win.find(p => cleanName(p.name, metroOf(p.name)) === B.name)?.name ?? "";
    lights.push({ s: Math.round((A.s + B.s) / 2), street: crossStreet(raw) ?? "Semáforo" });
  }
  const ejes = {};
  win.forEach(p => { if (p.eje) ejes[p.eje] = (ejes[p.eje] ?? 0) + 1; });
  const eje = Object.entries(ejes).sort((x, y) => y[1] - x[1])[0]?.[0] ?? "";
  const first = routeStops[0], last = routeStops.at(-1);
  return {
    id: cod, name: title(eje).replace(/^Avenida /, "Av. ") || cod, color,
    from: first.name, to: last.name,
    destino: ida.destino, origen: d.regreso?.destino ?? "", operador: d.negocio?.nombre ?? "",
    stops: routeStops, lights, length: last.s + 140,
  };
}

/** Un recorrido en forma legible: un paradero o semáforo por línea. */
function fmt(r) {
  const { stops, lights, ...head } = r;
  const one = (o) => "      " + JSON.stringify(o);
  return `  {\n    ...${JSON.stringify(head)},\n    stops: [\n${stops.map(one).join(",\n")},\n    ],\n    lights: [\n${lights.map(one).join(",\n")},\n    ],\n  }`;
}

const routes = SERVICES.map(build).filter(Boolean);
if (process.argv.includes("--ver")) {
  for (const r of routes) console.log(`${r.id} ${r.name}: ${r.from} → ${r.to} · ${r.stops.length} paraderos · ${(r.length / 1000).toFixed(1)} km · Metro: ${r.stops.filter(s => s.metro).map(s => s.metro).join(", ")}`);
} else {
  const today = new Date().toISOString().slice(0, 10);
  const body = `/* ==========================================================================
   RedMoviSim — bus/redRoutes.js  (GENERADO: no editar a mano)
   Recorridos reales de buses Red, tomados de la API pública de red.cl el ${today}
   con \`node tools/recorridos-red.mjs\`. De cada servicio es un tramo jugable
   (sentido ida) por estaciones de Metro; s = metros por el trazado real.
   ========================================================================== */

export const RED_ROUTES = [
${routes.map(fmt).join(",\n")},
];
`;
  writeFileSync(new URL("../js/bus/redRoutes.js", import.meta.url), body);
  console.log(`js/bus/redRoutes.js · ${routes.length} recorridos`);
}
