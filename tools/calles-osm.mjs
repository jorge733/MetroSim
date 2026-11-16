/* ==========================================================================
   RedMoviSim — 2.6 / 2.7 · tools/calles-osm.mjs
   Genera la CALLE REAL de cada estación a partir de OpenStreetMap
   (© colaboradores de OpenStreetMap, ODbL):
     · js/city/calles/<estación>.json   la calle (edificios, calzadas…), en decímetros
     · js/city/realStreets.js           lo que el juego necesita sin cargarla
                                        (locales, kiosko, paradero, hito, giro)

   El juego no consulta OSM en vivo (anda sin conexión y en el APK): esto es
   una «foto». Todo queda en las coordenadas locales de la calle del juego
   (city/plan.js · STREET): la avenida a lo largo de Z y el acceso elegido en
   la vereda +X, donde el juego pone la boca de la escalera (x = 9,6, boca en
   z = +3,2), así cae sobre la salida de la mezanina.

   Por estación, solo:
     · el ACCESO: el acceso real más cercano donde la escalera cabe en la
       vereda (se corre hasta 7 m si hace falta); en las estaciones de EFE,
       un punto de la vereda junto a la estación;
     · la AVENIDA: la calle más importante a menos de 45 m del acceso;
     · el HITO (city/catalog.js) por su nombre en OSM (edificio, plaza,
       parque o monumento); si no está cerca, la vereda de enfrente;
     · edificios con su planta y altura (height, building:levels, la tabla
       HEIGHTS o una estimación: casas de 1–2 pisos, o los pisos de los
       vecinos que sí la tienen), calzadas con su ancho, soleras, pistas,
       pasos de cebra, semáforos, árboles, pasto, faroles y las pistas de
       los autos; los locales del juego sobre fachadas reales (o puestos).

   Uso:
     1. curl -o /tmp/osm/Santiago.osm.pbf https://download.bbbike.org/osm/bbbike/Santiago/Santiago.osm.pbf
     2. node tools/calles-osm.mjs --lista > /tmp/osm/estaciones.json
     3. python3 tools/zonas-osm.py /tmp/osm/Santiago.osm.pbf /tmp/osm/estaciones.json /tmp/osm/zonas
     4. node tools/calles-osm.mjs --zonas /tmp/osm/zonas      [--solo "NOMBRE"] [--ver]
   ========================================================================== */

import { writeFileSync } from "node:fs";

/** Ajustes a mano por estación (lo demás se calcula solo). prefer: accesos OSM preferidos. */
const OVERRIDES = {
  "UNIVERSIDAD DE CHILE": {
    prefer: [6257072288],                          // acceso E · Arturo Prat
    landmark: { way: 25018684 },                   // Casa Central de la Universidad de Chile
  },
};
/** Alturas conocidas (m) de edificios que en OSM no la tienen (por id de way). */
const HEIGHTS = { 25018684: 17, 394238: 16, 114621538: 18, 12721099: 26, 24964144: 22, 11317315: 30, 11317398: 34,
  157650982: 9, 11352836: 40, 40221637: 42, 40222168: 34 };
/** Cómo se llama en OSM el hito de cada estación (city/catalog.js). */
const LANDMARK_RX = {
  "ESTACIÓN CENTRAL": /Estaci[oó]n Central|Alameda/i,
  "LOS HÉROES": /H[eé]roes de (la )?Concepci[oó]n|Los H[eé]roes/i,
  "LA MONEDA": /Palacio de La Moneda/i,
  "UNIVERSIDAD DE CHILE": /Casa Central Universidad de Chile/i,
  "SANTA LUCÍA": /Cerro Santa Luc[ií]a|Santa Luc[ií]a/i,
  "UNIVERSIDAD CATÓLICA": /Casa Central.*Cat[oó]lica|Pontificia Universidad Cat[oó]lica|Casa Central UC/i,
  "BAQUEDANO": /Plaza Baquedano|Plaza Italia|Plaza de la Dignidad/i,
  "TOBALABA": /Costanera Center|Gran Torre/i,
  "ESCUELA MILITAR": /Escuela Militar/i,
  "LOS DOMINICOS": /Los Dominicos|San Vicente Ferrer/i,
  "FRANKLIN": /Persa B[ií]o ?B[ií]o|B[ií]o B[ií]o/i,
  "PUENTE CAL Y CANTO": /Mercado Central/i,
  "PLAZA DE ARMAS": /Catedral Metropolitana|Catedral de Santiago/i,
  "PLAZA EGAÑA": /Mall Plaza Ega[ñn]a|Plaza Ega[ñn]a/i,
  "BELLAVISTA DE LA FLORIDA": /Mall Plaza Vespucio|Plaza Vespucio/i,
  "PLAZA DE PUENTE ALTO": /Plaza de (Armas de )?Puente Alto/i,
  "BELLAS ARTES": /Museo Nacional de Bellas Artes|Bellas Artes/i,
  "QUINTA NORMAL": /Quinta Normal/i,
  "PLAZA DE MAIPÚ": /Templo Votivo|Santuario Nacional|Votivo de Maip[uú]/i,
  "ESTADIO NACIONAL": /Estadio Nacional/i,
};

const ACCESS = { x: 9.6, z: 3.2 };                 // boca del acceso en la calle del juego
const LANE_W = 3.3;
const LOW = new Set(["house", "detached", "residential", "terrace", "semidetached_house", "bungalow", "farm", "static_caravan"]);
const ROAD = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
  "living_street", "primary_link", "secondary_link", "tertiary_link", "service", "busway"]);
const DRIVE = new Set(["trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "primary_link", "secondary_link", "tertiary_link", "living_street"]);
const DEF_LANES = { trunk: 3, primary: 3, secondary: 2, tertiary: 2, unclassified: 2, residential: 2, living_street: 1, service: 1, busway: 1 };

const args = process.argv.slice(2);
const r1 = (v) => Math.round(v * 10) / 10;

/* ---------- geometría plana ---------- */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
function closestOnSeg(p, a, b) {
  const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return [a[0] + ab[0] * t, a[1] + ab[1] * t, t];
}
function distToPolyline(p, pts) {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) { const c = closestOnSeg(p, pts[i], pts[i + 1]); best = Math.min(best, Math.hypot(p[0] - c[0], p[1] - c[1])); }
  return best;
}
function inPoly(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
const area = (ring) => ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
/** Desplaza una polilínea `off` metros a la derecha (en coordenadas locales x,z; derecha de quien avanza). */
function offsetLine(pts, off) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const d = norm(sub(b, a));
    // avanzar por d (x,z): la derecha es (−d.z, d.x)… en el juego −Z es «adelante» con +X a la derecha → derecha = (−dz, dx)
    const r = [-d[1], d[0]];
    let k = 1;
    if (i > 0 && i < pts.length - 1) {
      const d1 = norm(sub(p, a)), d2 = norm(sub(b, p));
      const cos = Math.max(0.5, dot(norm([d1[0] + d2[0], d1[1] + d2[1]]), d1));
      k = 1 / cos;
    }
    return [p[0] + r[0] * off * k, p[1] + r[1] * off * k];
  });
}
function resample(pts, step) {
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], L = len(sub(b, a)), n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  if (pts.length) out.push(pts.at(-1));
  return out;
}
/** Douglas–Peucker: quita puntos que se apartan menos de tol metros de la recta. */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let md = 0, mk = -1;
    for (let k = i + 1; k < j; k++) { const c = closestOnSeg(pts[k], pts[i], pts[j]); const d = Math.hypot(pts[k][0] - c[0], pts[k][1] - c[1]); if (d > md) { md = d; mk = k; } }
    if (md > tol) { keep[mk] = 1; stack.push([i, mk], [mk, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}
const polyLen = (pts) => pts.reduce((s, p, i) => (i ? s + len(sub(p, pts[i - 1])) : 0), 0);
/** Intersección del rayo p + t·d con el segmento ab: t o null. */
function raySeg(p, d, a, b) {
  const e = sub(b, a), den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-9) return null;
  const w = sub(a, p), t = (w[0] * e[1] - w[1] * e[0]) / den, u = (w[0] * d[1] - w[1] * d[0]) / den;
  return t > 0 && u >= 0 && u <= 1 ? t : null;
}
function seeded(n) { let a = (n * 2654435761) >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const CLASS_RANK = { trunk: 0, primary: 0, secondary: 1, tertiary: 2, primary_link: 2, secondary_link: 2, unclassified: 3, residential: 3, living_street: 4, service: 6, busway: 2, motorway: 5 };
const roadOk = (t) => ROAD.has(t.highway) && t.area !== "yes" && !t.tunnel && t.covered !== "yes" && !(+t.layer < 0) && t.indoor !== "yes" && !t.bridge
  && !(t.highway === "service" && t.service && t.service !== "alley" && t.service !== "driveway");
const roadWidth = (t) => +t.width || Math.max(3.2, (+t.lanes || DEF_LANES[t.highway] || 2) * (t.highway === "service" || t.highway === "living_street" ? 3.0 : LANE_W));

/**
 * Elige el acceso y la avenida: el primer acceso (real o, en las estaciones de tren, uno en la vereda junto a la
 * estación) donde la escalera del juego cabe en la vereda sin pisar calzadas ni edificios.
 */
function chooseFrame(nodes, ways, cfg) {
  const st = cfg.station, kx = 111320 * Math.cos(st.lat * Math.PI / 180), ky = 110574;
  const EN = (n) => [(n.lon - st.lon) * kx, (n.lat - st.lat) * ky];
  const roads = [], blds = [];
  for (const w of ways.values()) {
    const t = w.tags || {};
    const pts = w.nodes.map(id => nodes.get(id)).filter(Boolean).map(EN);
    if (pts.length < 2 || !pts.some(p => Math.hypot(p[0], p[1]) < 500)) continue;
    if (roadOk(t)) roads.push({ id: w.id, pts, w: roadWidth(t), rank: CLASS_RANK[t.highway] ?? 5, key: t.name ? "n:" + t.name : "w:" + w.id, drive: DRIVE.has(t.highway) });
    else if (t.building && !t["building:part"] && w.nodes[0] === w.nodes.at(-1) && t.building !== "roof" && !(+t.layer < 0)) blds.push(pts);
  }
  const cands = [];
  for (const n of nodes.values()) {
    if (n.tags?.railway !== "subway_entrance" && n.tags?.railway !== "train_station_entrance" && n.tags?.entrance !== "main" || !n.tags) continue;
    if (n.tags.entrance === "main" && !n.tags.railway) continue;
    const p = EN(n), d = Math.hypot(p[0], p[1]);
    if (d < 320 && !cfg.synth) cands.push({ p, d: d - (cfg.prefer?.includes(n.id) ? 1000 : 0), name: n.tags.name || "", id: n.id });
  }
  cands.sort((a, b) => a.d - b.d);
  // Además (o, en los trenes, en vez de los accesos): puntos de la vereda de las calles cercanas a la estación
  {
    const near = roads.filter(r => r.drive).map(r => {
      let best = null;
      for (let i = 0; i + 1 < r.pts.length; i++) { const c = closestOnSeg([0, 0], r.pts[i], r.pts[i + 1]); const d = Math.hypot(c[0], c[1]); if (!best || d < best.d) best = { d, c, dir: norm(sub(r.pts[i + 1], r.pts[i])) }; }
      return { r, ...best };
    }).filter(x => x.d < 220).sort((a, b) => a.d + a.r.rank * 15 - (b.d + b.r.rank * 15));
    for (const x of near.slice(0, 6)) {
      const nrm = [x.dir[1], -x.dir[0]], side = dot([-x.c[0], -x.c[1]], nrm) >= 0 ? 1 : -1;
      for (const off of [3, 4.5, 6.5]) for (const sd of [side, -side]) for (const along of [0, 10, -10, 20, -20, 35, -35, 55, -55]) {
        const q = [x.c[0] + nrm[0] * sd * (x.r.w / 2 + off) + x.dir[0] * along, x.c[1] + nrm[1] * sd * (x.r.w / 2 + off) + x.dir[1] * along];
        cands.push({ p: q, d: Math.hypot(q[0], q[1]), name: "", id: null, synth: 1 });
      }
    }
  }
  const onRoad = (q, m = 0) => roads.some(r => distToPolyline(q, r.pts) < r.w / 2 - m);
  const inB = (q) => blds.some(b => inPoly(q, b));
  for (const c of cands) {
    // Avenida: la calle más importante a menos de 45 m del acceso
    let pick = null;
    for (const r of roads) {
      const d = distToPolyline(c.p, r.pts);
      if (d > 45) continue;
      const score = r.rank * 18 + d;
      if (!pick || score < pick.score) pick = { score, key: r.key };
    }
    if (!pick) continue;
    let best = null;
    for (const r of roads.filter(q => q.key === pick.key)) for (let i = 0; i + 1 < r.pts.length; i++) {
      const cc = closestOnSeg(c.p, r.pts[i], r.pts[i + 1]), d = Math.hypot(c.p[0] - cc[0], c.p[1] - cc[1]);
      if (!best || d < best.d) best = { d, dir: norm(sub(r.pts[i + 1], r.pts[i])), c: cc };
    }
    let dir = best.dir;
    if (dot(sub(c.p, best.c), [dir[1], -dir[0]]) < 0) dir = [-dir[0], -dir[1]];
    const [de, dn] = dir;
    // El punto de OSM es aproximado: se corre hasta 7 m (alejándose de la calzada o a lo largo) si ahí no cabe
    const shifts = c.synth ? [[0, 0]] : [[0, 0], [1.5, 0], [3, 0], [0, 4], [0, -4], [3, 4], [3, -4], [5, 0], [1.5, 8], [1.5, -8], [7, 0], [5, 6], [5, -6]];
    let found = null;
    for (const [ox, oz] of shifts) {
      const o = [c.p[0] + ox * dn + (-oz) * de, c.p[1] - ox * de + (-oz) * dn];
      const toEN = (x, z) => { const u = x - ACCESS.x, v = -(z - ACCESS.z); return [o[0] + u * dn + v * de, o[1] - u * de + v * dn]; };
      let ok = true;
      for (let x = 8.1; x <= 11.1 && ok; x += 0.75) for (let z = -3.8; z <= 6; z += 0.9) {
        const q = toEN(x, z);
        if (inB(q) || onRoad(q, -0.3)) { ok = false; break; }
      }
      if (ok) { found = o; break; }
    }
    if (!found) continue;
    if (Math.hypot(found[0], found[1]) > 330) continue;
    const lat = st.lat + found[1] / ky, lon = st.lon + found[0] / kx;
    return { lat, lon, dir, avenueKey: pick.key, name: c.name, synth: !!c.synth };
  }
  return null;
}

function build(data, cfg) {
  const R = cfg.radius;
  const nodes = new Map(), ways = new Map(), rels = [];
  for (const e of data.elements) {
    if (e.type === "node") nodes.set(e.id, e);
    else if (e.type === "way") ways.set(e.id, e);
    else rels.push(e);
  }
  const frame = chooseFrame(nodes, ways, cfg);
  if (!frame) return null;
  const lat0 = frame.lat, lon0 = frame.lon, kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110574;
  const en = (n) => [(n.lon - lon0) * kx, (n.lat - lat0) * ky];
  const isAvenue = (w) => frame.avenueKey === (w.tags?.name ? "n:" + w.tags.name : "w:" + w.id);
  const [de, dn] = frame.dir;
  const ent = { tags: { name: frame.name || (frame.synth ? "vereda junto a la estación" : "") } };
  // este/norte → local (x a la derecha, −z adelante) con el acceso en la boca del juego
  const L = ([e, n]) => [e * dn - n * de + ACCESS.x, -(e * de + n * dn) + ACCESS.z];
  const P = (id) => { const n = nodes.get(id); return n ? L(en(n)) : null; };
  const near = (p, extra = 0) => Math.max(Math.abs(p[0] - ACCESS.x), Math.abs(p[1] - ACCESS.z)) < R + extra;
  const wayPts = (w) => w.nodes.map(P).filter(Boolean);

  /* ---------- Calzadas ---------- */
  const roads = [];
  for (const w of ways.values()) {
    const t = w.tags || {};
    if (!roadOk(t)) continue;
    const pts = wayPts(w);
    if (pts.length < 2 || !pts.some(p => near(p, 60))) continue;
    const lanes = +t.lanes || DEF_LANES[t.highway] || 2;
    const width = roadWidth(t);
    const oneway = t.oneway === "yes" || t.oneway === "1" || t.junction === "roundabout";
    const rev = t.oneway === "-1";
    roads.push({ id: w.id, pts: rev ? pts.reverse() : pts, nodes: rev ? [...w.nodes].reverse() : w.nodes, w: width, lanes, oneway: oneway || rev, hw: t.highway, name: t.name || "", bus: t.busway || t["lanes:bus"] ? 1 : 0, avenue: isAvenue(w) });
  }
  /** ¿El punto cae sobre alguna calzada (salvo la indicada)? */
  const onRoad = (p, except = null, margin = 0.15) => roads.some(r => r !== except && distToPolyline(p, r.pts) < r.w / 2 - margin);

  /* ---------- Edificios ---------- */
  const palette = 9;
  const buildings = [], roofs = [];
  const addBuilding = (id, ring, t) => {
    if (ring.length < 3 || !ring.some(p => near(p, 30))) return;
    if (area(ring) < 0) ring.reverse();                     // antihorario: las normales de los muros apuntan afuera
    const rnd = seeded(id);
    if (t.building === "roof" || t.building === "canopy") {
      const min = +t.min_height || +t["building:min_level"] * 3.3 || 3.6;
      roofs.push({ ring, y: r1(min) });
      return;
    }
    if (["bridge", "construction", "ruins"].includes(t.building)) return;
    let h = HEIGHTS[id] || +String(t.height || "").replace(",", ".") || 0;
    const lv = +t["building:levels"];
    if (!h && lv) h = lv * 3.3 + 1.2;
    if (!h) {
      // Sin altura en OSM: según el tipo de edificio, los pisos de los vecinos que sí la tienen y el tamaño de la planta
      const A = Math.abs(area(ring));
      let lv;
      if (LOW.has(t.building)) lv = 1 + (rnd() < 0.45 ? 1 : 0);
      else if (["church", "chapel", "cathedral"].includes(t.building) || t.amenity === "place_of_worship") { h = 16; }
      else if (["garages", "garage", "kiosk", "shed", "hut", "carport", "service"].includes(t.building)) h = 3.6;
      else if (A < 120) lv = 1 + Math.floor(rnd() * 2);
      else if (knownLevels.length >= 8) {
        lv = knownLevels[Math.floor(rnd() * knownLevels.length)];
        if (A < 250) lv = Math.min(lv, 4);
      } else lv = A < 400 ? 1 + Math.floor(rnd() * 3) : 2 + Math.floor(rnd() * 3);
      if (!h) h = lv * 3.3 + 1.2;
    }
    const levels = Math.max(1, Math.round((h - 1.2) / 3.3));
    const heritage = !!(t.heritage || t.historic || ["church", "civic", "government"].includes(t.building)) && levels <= 6;
    const style = heritage ? 1 : h > 45 && rnd() < 0.6 ? 2 : levels <= 3 ? 1 : 0;   // 0 oficinas · 1 clásico · 2 muro cortina
    buildings.push({ id, ring, h: r1(h), c: Math.floor(rnd() * palette), s: style, name: t.name || "" });
  };
  // Pisos de los edificios de la zona que sí tienen altura en OSM (para estimar los que no)
  const knownLevels = [];
  for (const w of ways.values()) {
    const t = w.tags || {};
    if (!t.building || t["building:part"] || LOW.has(t.building)) continue;
    const lv = +t["building:levels"] || (+String(t.height || "").replace(",", ".") - 1.2) / 3.3;
    if (lv >= 1 && lv < 80 && wayPts(w).some(p => near(p, 150))) knownLevels.push(Math.round(lv));
  }
  for (const w of ways.values()) {
    const t = w.tags || {};
    if (!t.building || t["building:part"] || t.location === "underground" || +t.layer < 0) continue;
    if (w.nodes[0] !== w.nodes.at(-1)) continue;
    addBuilding(w.id, wayPts(w).slice(0, -1), t);
  }
  for (const r of rels) {
    const t = r.tags || {};
    if (!t.building) continue;
    // Anillos exteriores (se unen los trozos de way que comparten extremos)
    let parts = r.members.filter(m => m.type === "way" && m.role !== "inner").map(m => ways.get(m.ref)?.nodes).filter(Boolean).map(a => [...a]);
    while (parts.length) {
      let ring = parts.shift();
      let grew = true;
      while (ring[0] !== ring.at(-1) && grew) {
        grew = false;
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i];
          if (p[0] === ring.at(-1)) ring = ring.concat(p.slice(1));
          else if (p.at(-1) === ring.at(-1)) ring = ring.concat([...p].reverse().slice(1));
          else continue;
          parts.splice(i, 1); grew = true; break;
        }
      }
      if (ring[0] === ring.at(-1)) addBuilding(r.id, ring.slice(0, -1).map(P).filter(Boolean), t);
    }
  }
  const inBuilding = (p, m = 0) => buildings.some(b => inPoly(p, b.ring) || (m > 0 && distToRing(p, b.ring) < m));
  function distToRing(p, ring) { return distToPolyline(p, [...ring, ring[0]]); }

  /* ---------- Soleras, líneas de pista, pasos de cebra, semáforos, faroles ---------- */
  const curbs = [], dashes = [], center = [];
  const runs = (samples, keep) => {
    const out = []; let cur = [];
    for (const p of samples) { if (keep(p)) cur.push(p); else { if (cur.length > 1) out.push(cur); cur = []; } }
    if (cur.length > 1) out.push(cur);
    return out;
  };
  for (const r of roads) {
    for (const s of [-1, 1]) {
      const line = resample(offsetLine(r.pts, s * r.w / 2), 1.5);
      for (const run of runs(line, p => near(p, 20) && !onRoad(p, r, 0.25))) curbs.push(run);
    }
    if (r.hw === "service") continue;
    const dash = (off, out) => {
      const line = resample(offsetLine(r.pts, off), 1);
      for (const run of runs(line, p => near(p, 10) && !onRoad(p, r, -1.2))) {
        for (let i = 0; i + 3 < run.length; i += 9) out.push([run[i], run[i + 3]]);
      }
    };
    if (r.oneway) for (let k = 1; k < r.lanes; k++) dash(-r.w / 2 + k * r.w / r.lanes, dashes);
    else if (r.lanes >= 2) {
      const line = resample(r.pts, 1);
      for (const run of runs(line, p => near(p, 10) && !onRoad(p, r, -1.2))) center.push(run);
    }
  }
  const nodeRoad = new Map();               // nodo → [{ road, i }]
  roads.forEach(r => r.nodes.forEach((id, i) => { if (!nodeRoad.has(id)) nodeRoad.set(id, []); nodeRoad.get(id).push({ r, i }); }));
  const dirAt = (r, i) => norm(sub(r.pts[Math.min(r.pts.length - 1, i + 1)], r.pts[Math.max(0, i - 1)]));
  const angOf = (d) => Math.atan2(d[0], d[1]);   // ángulo de giro (y) para que +Z local del objeto apunte en d
  const crossings = [], signals = [], lamps = [];
  const avAxis = [0, -1];
  for (const [id, n] of nodes) {
    const t = n.tags;
    if (!t) continue;
    const on = nodeRoad.get(id);
    const p = P(id);
    if (!p || !near(p, 5)) continue;
    if ((t.highway === "crossing" || t.crossing || t["crossing:markings"]) && on?.length) {
      const { r, i } = on.find(o => o.r.hw !== "service") || on[0];
      crossings.push([r1(p[0]), r1(p[1]), +angOf(dirAt(r, i)).toFixed(3), r1(r.w)]);
    }
    if (t.highway === "traffic_signals" && on?.length) {
      const { r, i } = on[0];
      const d = dirAt(r, i), rt = [-d[1], d[0]];
      const axis = Math.abs(dot(d, avAxis)) > 0.7 ? 0 : 1;
      const put = (s) => {
        const q = [p[0] + rt[0] * s * (r.w / 2 + 0.7), p[1] + rt[1] * s * (r.w / 2 + 0.7)];
        if (!onRoad(q) && !inBuilding(q)) signals.push([r1(q[0]), r1(q[1]), +angOf(s > 0 ? [-d[0], -d[1]] : d).toFixed(3), axis]);
      };
      put(1);
      if (!r.oneway) put(-1);
    }
  }
  for (const r of roads) {
    if (!["primary", "secondary", "tertiary", "trunk"].includes(r.hw)) continue;
    for (const s of [-1, 1]) {
      const line = resample(offsetLine(r.pts, s * (r.w / 2 + 0.6)), 1);
      for (let i = 10; i < line.length; i += 28) {
        const q = line[i];
        if (!near(q, -5) || onRoad(q) || inBuilding(q, 0.6)) continue;
        const d = dirAt({ pts: line }, i);
        lamps.push([r1(q[0]), r1(q[1]), +angOf([s > 0 ? d[1] : -d[1], s > 0 ? -d[0] : d[0]]).toFixed(3)]);
      }
    }
  }

  /* ---------- Árboles y pasto ---------- */
  const trees = [];
  for (const n of nodes.values()) {
    if (n.tags?.natural !== "tree") continue;
    const p = L(en(n));
    if (near(p, -2) && !onRoad(p, null, 0.6) && !inBuilding(p)) trees.push(r1(p[0]), r1(p[1]));
  }
  for (const w of ways.values()) {
    if (w.tags?.natural !== "tree_row") continue;
    for (const p of resample(wayPts(w), 8)) if (near(p, -2) && !onRoad(p, null, 0.6) && !inBuilding(p)) trees.push(r1(p[0]), r1(p[1]));
  }
  const grass = [];
  for (const w of ways.values()) {
    const t = w.tags || {};
    if (!(t.leisure === "park" || t.leisure === "garden" || t.landuse === "grass" || t.landuse === "village_green" || t.natural === "grassland")) continue;
    if (w.nodes[0] !== w.nodes.at(-1)) continue;
    const ring = wayPts(w).slice(0, -1);
    if (ring.length >= 3 && ring.some(p => near(p, 10))) grass.push(ring);
  }

  /* ---------- Pistas para los autos (calles en su sentido, con sus semáforos) ---------- */
  const signalNodes = new Set([...nodes.values()].filter(n => n.tags?.highway === "traffic_signals").map(n => n.id));
  const drive = roads.filter(r => DRIVE.has(r.hw));
  const chains = [];
  const dirWays = [];
  for (const r of drive) {
    dirWays.push({ r, pts: r.pts, nodes: r.nodes, fwd: true });
    if (!r.oneway) dirWays.push({ r, pts: [...r.pts].reverse(), nodes: [...r.nodes].reverse(), fwd: false });
  }
  const used = new Set();
  for (const s of dirWays) {
    if (used.has(s)) continue;
    used.add(s);
    let chain = [s];
    for (let grow = true; grow; ) {                     // hacia adelante
      grow = false;
      const end = chain.at(-1).nodes.at(-1);
      const nx = dirWays.find(o => !used.has(o) && o.nodes[0] === end && o.r.name === s.r.name);
      if (nx) { used.add(nx); chain.push(nx); grow = true; }
    }
    for (let grow = true; grow; ) {                     // hacia atrás
      grow = false;
      const start = chain[0].nodes[0];
      const pv = dirWays.find(o => !used.has(o) && o.nodes.at(-1) === start && o.r.name === s.r.name);
      if (pv) { used.add(pv); chain.unshift(pv); grow = true; }
    }
    chains.push(chain);
  }
  const lanes = [];
  for (const chain of chains) {
    const pts = [], sig = [];
    let acc = 0;
    for (const seg of chain) {
      seg.pts.forEach((p, i) => {
        if (pts.length && i === 0) return;
        if (pts.length) acc += len(sub(p, pts.at(-1)));
        pts.push(p);
        if (signalNodes.has(seg.nodes[i])) sig.push(r1(acc));
      });
    }
    if (polyLen(pts) < 50) continue;
    const r = chain[0].r;
    const n = r.oneway ? r.lanes : Math.max(1, Math.ceil(r.lanes / 2));
    const half = r.oneway ? r.w : r.w / 2;
    for (let k = 0; k < Math.min(n, 4); k++) {
      const off = r.oneway ? r.w / 2 - (k + 0.5) * r.w / n : half - (k + 0.5) * half / n;
      const lp = offsetLine(pts, off);
      lanes.push({ pts: lp, sig, kind: r.hw, bus: r.avenue && k === 0 ? 1 : 0 });
    }
  }

  /* ---------- Lo del juego: locales, kiosko, paradero, hito ---------- */
  const avenueRight = (z) => {                          // borde derecho de la calzada de la avenida más a la derecha en z
    let bestX = -Infinity;
    for (const r of roads.filter(q => q.avenue)) for (let i = 0; i + 1 < r.pts.length; i++) {
      const [a, b] = [r.pts[i], r.pts[i + 1]];
      if ((a[1] - z) * (b[1] - z) > 0 || a[1] === b[1]) continue;
      const x = a[0] + (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + r.w / 2;
      if (x < ACCESS.x && x > bestX) bestX = x;
    }
    return bestX === -Infinity ? ACCESS.x - 4 : bestX;
  };
  const facadeAt = (z) => {
    const curb = avenueRight(z), o = [curb + 0.3, z];
    let hit = null;
    for (const b of buildings) for (let i = 0; i < b.ring.length; i++) {
      if (b.id === cfg.landmark?.way) continue;                              // el hito no tiene locales
      const a = b.ring[i], c = b.ring[(i + 1) % b.ring.length], t = raySeg(o, [1, 0], a, c);
      if (t != null && (!hit || t < hit.t)) hit = { t, a, c, b };
    }
    if (!hit || hit.t > 32) return null;
    const e = norm(sub(hit.c, hit.a)), nrm = [e[1], -e[0]];                    // ring antihorario → afuera = (ez, −ex)
    const p = [o[0] + hit.t, z];
    const reach = Math.min(dot(sub(hit.c, p), e), dot(sub(p, hit.a), e));
    return { p, n: nrm, e, curb, reach, b: hit.b };
  };
  // Fachadas reales de la vereda del Metro (sin el hito), recorriendo la cuadra; se eligen las más cercanas al acceso
  const cands = [];
  for (let z = -88; z <= 88; z += 2) {
    if (Math.abs(z) < 9) continue;
    const f = facadeAt(z);
    if (!f || f.reach < 3.5 || Math.abs(f.n[0] + 1) > 0.6) continue;         // muro mirando a la avenida
    const door = [f.p[0] + f.n[0] * 1.2, f.p[1] + f.n[1] * 1.2];
    if (onRoad(door) || inBuilding(door)) continue;
    cands.push({ x: r1(f.p[0]), z: r1(f.p[1]), a: +angOf(f.n).toFixed(3), w: r1(Math.min(11, f.reach * 2 - 1)), door: [r1(door[0]), r1(door[1])], reach: f.reach });
  }
  cands.sort((a, b) => (b.reach >= 5.5) - (a.reach >= 5.5) || Math.abs(a.z) - Math.abs(b.z));
  const shops = [];
  for (const c of cands) if (shops.length < 6 && shops.every(s => Math.abs(s.z - c.z) > 12)) { delete c.reach; shops.push(c); }
  // Lo que falte: puestos en la vereda (como los de la Alameda), en las z libres del plan
  for (const z0 of [-66, -44, -22, 22, 44, 66, -80, 80]) {
    if (shops.length >= 6) break;
    if (shops.some(s => Math.abs(s.z - z0) < 10)) continue;
    const curb = avenueRight(z0);
    shops.push({ x: r1(curb + 3.4), z: z0, a: -Math.PI / 2, w: 0, stand: 1, door: [r1(curb + 1.5), z0] });
  }
  shops.sort((a, b) => a.z - b.z);
  const kz = -11, kc = avenueRight(kz), kf = facadeAt(kz);
  const kioskX = kf ? Math.max(kc + 2.3, Math.min(kf.p[0] - 1.6, kc + 3.2)) : kc + 3;
  const kiosk = { x: r1(kioskX), z: kz, door: [r1(kioskX - 1.9), kz] };

  let bus = null;
  for (const n of nodes.values()) {
    if (n.tags?.highway !== "bus_stop" && n.tags?.public_transport !== "platform") continue;
    const p = L(en(n));
    if (p[0] < avenueRight(p[1]) - 1 || Math.abs(p[1]) > 90 || Math.abs(p[1]) < 10) continue;
    const d = Math.abs(p[1] - 34);
    if (!bus || d < bus.d) bus = { d, x: p[0], z: p[1] };
  }
  const busStop = bus ? { x: r1(Math.max(avenueRight(bus.z) + 1.2, Math.min(bus.x, avenueRight(bus.z) + 2))), z: r1(bus.z), real: 1 }
    : { x: r1(avenueRight(34) + 1.5), z: 34, real: 0 };

  let landmark = null;
  const centroid = (ring) => [ring.reduce((t, p) => t + p[0], 0) / ring.length, ring.reduce((t, p) => t + p[1], 0) / ring.length];
  const dAcc = (p) => Math.hypot(p[0] - ACCESS.x, p[1] - ACCESS.z);
  const freeSpot = (p, toward = [ACCESS.x, ACCESS.z]) => {   // se acerca al acceso hasta quedar en la vereda
    const d = norm(sub(toward, p));
    for (let k = 0; k <= 30; k++) {
      const q = [p[0] + d[0] * k, p[1] + d[1] * k];
      if (near(q, -15) && !inBuilding(q, 0.8) && !onRoad(q, null, -0.8)) return q;
    }
    return null;
  };
  const rx = cfg.landmarkRx;
  const lmB = buildings.find(b => b.id === cfg.landmark?.way)
    || (rx && buildings.filter(b => rx.test(b.name) && near(centroid(b.ring), -20)).sort((p, q) => dAcc(centroid(p.ring)) - dAcc(centroid(q.ring)))[0]);
  if (lmB) {
    // Punto del muro más cercano al acceso que mira a una calle; la foto se saca 5 m afuera
    let bestP = null;
    for (let i = 0; i < lmB.ring.length; i++) {
      const a = lmB.ring[i], c = lmB.ring[(i + 1) % lmB.ring.length];
      const m = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2], e = norm(sub(c, a)), nrm = [e[1], -e[0]];
      if (len(sub(c, a)) < 6) continue;
      const spot = [m[0] + nrm[0] * 5, m[1] + nrm[1] * 5];
      if (inBuilding(spot) || onRoad(spot) || !near(spot, -15)) continue;
      const d = dAcc(spot);
      if (!bestP || d < bestP.d) bestP = { d, spot, wall: m, a: angOf(nrm) };
    }
    if (bestP) { landmark = { spot: bestP.spot.map(r1), wall: bestP.wall.map(r1), a: +bestP.a.toFixed(3), via: "edificio" }; lmB.lm = 1; }
  }
  if (!landmark && rx) {
    // Plaza, parque o monumento: el punto de su borde (o el monumento) más cercano al acceso
    let best = null;
    const consider = (p, via) => { const q = freeSpot(p); if (q && (!best || dAcc(q) < best.d)) best = { d: dAcc(q), q, via }; };
    for (const w of ways.values()) {
      if (!rx.test(w.tags?.name || "") || w.tags?.building || w.tags?.highway) continue;
      const ring = wayPts(w);
      let nb = null;
      for (const p of resample(ring, 2)) if (!nb || dAcc(p) < dAcc(nb)) nb = p;
      if (nb) consider(nb, "lugar");
    }
    for (const n of nodes.values()) if (n.tags && rx.test(n.tags.name || "") && !n.tags.railway && !n.tags.highway) consider(L(en(n)), "punto");
    if (best) landmark = { spot: best.q.map(r1), via: best.via };
  }
  if (!landmark && rx) {
    // No está cerca en OSM: la foto se saca en la vereda de enfrente, cruzando la avenida (como en la calle de siempre)
    for (const z of [0, 8, -8, 16, -16, 30, -30]) {
      let left = Infinity;
      for (const r of roads.filter(q => q.avenue)) for (let i = 0; i + 1 < r.pts.length; i++) {
        const [a2, b2] = [r.pts[i], r.pts[i + 1]];
        if ((a2[1] - z) * (b2[1] - z) > 0 || a2[1] === b2[1]) continue;
        left = Math.min(left, a2[0] + (b2[0] - a2[0]) * (z - a2[1]) / (b2[1] - a2[1]) - r.w / 2);
      }
      const q = [left - 4, z];
      if (left < Infinity && !inBuilding(q, 0.8) && !onRoad(q, null, -0.8)) { landmark = { spot: q.map(r1), via: "enfrente" }; break; }
    }
  }

  // Árboles que estorban la boca del acceso, el tótem, puertas o el paradero
  const keepFree = [[ACCESS.x, 0, 3.8], [ACCESS.x + 2, ACCESS.z + 0.7, 1.5], [busStop.x, busStop.z, 3.2], [kiosk.x, kiosk.z, 2.2], ...shops.map(s => [s.door[0], s.door[1], 1.4])];
  const freeOk = (x, z) => keepFree.every(([fx, fz, r]) => Math.hypot(x - fx, z - fz) > r);
  const treesOk = [];
  for (let i = 0; i < trees.length; i += 2) if (freeOk(trees[i], trees[i + 1])) treesOk.push(trees[i], trees[i + 1]);
  const lampsOk = lamps.filter(l => freeOk(l[0], l[1]));

  const q = (v) => Math.round(v * 10);                     // decímetros enteros: archivos más chicos
  const enc = (pts) => pts.flatMap(p => [q(p[0]), q(p[1])]);
  const geo = {
    b: buildings.map(b => [q(b.h), b.c, b.s, b.lm ? 1 : 0, ...enc(simplify(b.ring, 0.05))]),
    rf: roofs.map(r => [q(r.y), ...enc(r.ring)]),
    rd: roads.map(r => [q(r.w), r.hw === "service" ? 1 : 0, ...enc(r.pts)]),
    cb: curbs.map(c => enc(simplify(c, 0.08))).filter(c => c.length >= 4),
    ds: dashes.flatMap(([a2, b2]) => [q(a2[0]), q(a2[1]), q(b2[0]), q(b2[1])]),
    ce: center.map(c => enc(simplify(c, 0.08))).filter(c => c.length >= 4),
    cr: crossings.map(([x, z, a2, w]) => [q(x), q(z), Math.round(a2 * 1000), q(w)]),
    sg: signals.map(([x, z, a2, ax]) => [q(x), q(z), Math.round(a2 * 1000), ax]),
    lp: lampsOk.map(([x, z, a2]) => [q(x), q(z), Math.round(a2 * 1000)]),
    tr: treesOk.map(q),
    gr: grass.map(r => enc(simplify(r, 0.1))),
    ln: lanes.map(l => ({ p: enc(simplify(l.pts, 0.1)), s: l.sig.map(q), k: l.kind, b: l.bus })),
  };
  const meta = { e: ent.tags?.name || "", r: R, rot: [+dn.toFixed(5), +de.toFixed(5)], shops, kiosk, busStop, landmark };
  const st = { edificios: buildings.length, calles: roads.length, árboles: treesOk.length / 2, semáforos: signals.length, pistas: lanes.length, acceso: meta.e || "(vereda)", locales: shops.filter(s => !s.stand).length + "/6 en fachada", hito: landmark?.via || "-" };
  const out = { meta, geo };
  return { out, st };
}

const argOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
if (args.includes("--lista")) {
  // Lista de estaciones del juego (para tools/zonas-osm.py)
  const { LINES } = await import("../js/engine/network.js");
  const out = {};
  for (const l of LINES) for (const s of l.stations) (out[s.name] ??= []).push(l.id);
  console.log(JSON.stringify(out));
  process.exit(0);
}
const zonas = argOf("--zonas");
if (!zonas) { console.error("Uso: node tools/calles-osm.mjs --zonas <dir de tools/zonas-osm.py> [--solo NOMBRE] [--ver]"); process.exit(1); }
const { readFileSync, mkdirSync, readdirSync, unlinkSync } = await import("node:fs");
const indice = JSON.parse(readFileSync(`${zonas}/indice.json`, "utf8"));
const solo = argOf("--solo");
const meta = {};
const dir = new URL("../js/city/calles/", import.meta.url);
if (!args.includes("--ver")) mkdirSync(dir, { recursive: true });
let total = 0;
for (const z of indice) {
  if (solo && z.name !== solo) continue;
  const data = JSON.parse(readFileSync(`${zonas}/${z.slug}.json`, "utf8"));
  const cfg = { name: z.name, station: z.station, radius: 200, ...(OVERRIDES[z.name] || {}), landmarkRx: LANDMARK_RX[z.name] || null };
  if (z.lines.every(l => l === "NOS" || l === "RAN")) cfg.synth = true;   // estaciones de EFE: sin accesos del Metro
  const r = build(data, cfg);
  if (!r) { console.log(z.name, "· sin acceso donde quepa la escalera: queda con su calle de siempre"); continue; }
  const body = JSON.stringify(r.out.geo);
  total += body.length;
  meta[z.name] = { f: z.slug, ...r.out.meta };
  console.log(z.name, `${(body.length / 1024).toFixed(0)} KB`, JSON.stringify(r.st));
  if (!args.includes("--ver")) writeFileSync(new URL(`${z.slug}.json`, dir), body);
}
console.log(`${Object.keys(meta).length} calles · ${(total / 1024 / 1024).toFixed(1)} MB en js/city/calles/`);
if (!args.includes("--ver") && !solo) {
  for (const f of readdirSync(dir)) if (!Object.values(meta).some(m => `${m.f}.json` === f)) unlinkSync(new URL(f, dir));
  const body = `/* Generado por tools/calles-osm.mjs (${new Date().toISOString().slice(0, 10)}) — no editar a mano.
   Datos © colaboradores de OpenStreetMap (www.openstreetmap.org/copyright), licencia ODbL.
   Lo que el juego necesita saber de cada calle real sin cargarla (locales, paradero, hito); la calle
   misma (edificios, calzadas…) está en js/city/calles/<f>.json y la carga city/streetData.js. */
export const OSM_ATTRIBUTION = "© colaboradores de OpenStreetMap";
export const REAL_STREETS = ${JSON.stringify(meta)};
`;
  writeFileSync(new URL("../js/city/realStreets.js", import.meta.url), body);
  console.log(`js/city/realStreets.js · ${(body.length / 1024).toFixed(0)} KB`);
}
