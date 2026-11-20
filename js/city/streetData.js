/* ==========================================================================
   RedMoviSim — 2.7 · city/streetData.js
   Carga, cuando hace falta, la CALLE REAL de una estación (js/city/calles/
   <archivo>.json, generados por tools/calles-osm.mjs desde OpenStreetMap).

   Son ~130 calles de 15 a 70 KB: no se cargan todas al abrir el juego. La
   partida pide la de su estación antes de empezar y las de su línea en
   segundo plano; además, cada vez que el pasajero entra a una estación se
   pide la suya (cuando llega a la salida, ya está). Lo que se baja queda en
   memoria y la PWA lo guarda para jugar sin conexión.

   En los archivos las coordenadas van en decímetros enteros y los ángulos
   en milésimas de radián; aquí se pasan a metros y radianes, con la forma
   que usa city/realCity.js.
   ========================================================================== */

import { REAL_STREETS } from "./realStreets.js";

const raw = new Map();          // nombre → geometría tal como viene en el archivo
const pending = new Map();      // nombre → promesa de la descarga

export const hasRealStreet = (name) => !!REAL_STREETS[name];

/** Descarga (una vez) la calle real de la estación. Resuelve true si quedó lista. */
export function loadRealStreet(name) {
  const meta = REAL_STREETS[name];
  if (!meta) return Promise.resolve(false);
  if (raw.has(name)) return Promise.resolve(true);
  if (!pending.has(name)) {
    pending.set(name, fetch(new URL(`./calles/${meta.f}.json`, import.meta.url))
      .then(r => { if (!r.ok) throw new Error(`calle ${meta.f}: ${r.status}`); return r.json(); })
      .then(geo => { raw.set(name, geo); return true; })
      .catch(err => { pending.delete(name); console.warn("RedMoviSim · no se pudo cargar la calle real:", err.message); return false; }));
  }
  return pending.get(name);
}

/** Carga en segundo plano varias calles, de a una (para no trabar los cuadros). */
export async function prefetchStreets(names) {
  for (const n of names) {
    if (!hasRealStreet(n) || raw.has(n)) continue;
    await loadRealStreet(n);
    await new Promise(r => setTimeout(r, 150));
  }
}

/** Datos de la calle real ya decodificados (o null si no hay o aún no se descargó). */
export function realStreetData(name) {
  const meta = REAL_STREETS[name], g = raw.get(name);
  return meta && g ? decode(meta, g) : null;
}

const M = (v) => v / 10;
const A = (v) => v / 1000;
const coords = (a, from = 0) => a.map((v, i) => (i < from ? v : M(v)));

function decode(meta, g) {
  return {
    radius: meta.r, rot: meta.rot, entrance: meta.e, shops: meta.shops, kiosk: meta.kiosk, busStop: meta.busStop, landmark: meta.landmark,
    // 2.21 · El acceso del juego con su letra real, los otros accesos de la estación y los paraderos de Red de alrededor
    access: meta.access || null,
    accesses: (g.ac || []).map(([x, z, a, k, ref, name, lift]) => ({ x: M(x), z: M(z), a: A(a), inBuilding: k === 1, ref, name, lift: !!lift })),
    stops: (g.pa || []).map(([x, z, a, ref, n, name, routes, shelter, bench]) => ({ x: M(x), z: M(z), a: A(a), ref, n, name, routes: routes ? routes.split(";") : [], shelter: !!shelter, bench: !!bench })),
    buildings: g.b.map(b => [M(b[0]), b[1], b[2], b[3], ...b.slice(4).map(M)]),
    roofs: g.rf.map(r => r.map(M)),
    roads: g.rd.map(r => [M(r[0]), r[1], ...r.slice(2).map(M)]),
    curbs: g.cb.map(c => coords(c)),
    dashes: g.ds.map(M),
    center: g.ce.map(c => coords(c)),
    crossings: g.cr.map(([x, z, a, w]) => [M(x), M(z), A(a), M(w)]),
    signals: g.sg.map(([x, z, a, ax]) => [M(x), M(z), A(a), ax]),
    lamps: g.lp.map(([x, z, a]) => [M(x), M(z), A(a)]),
    trees: g.tr.map(M),
    grass: g.gr.map(r => coords(r)),
    lanes: g.ln.map(l => ({ p: l.p.map(M), sig: l.s.map(M), kind: l.k, bus: l.b })),
  };
}
