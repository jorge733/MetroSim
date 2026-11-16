/* ==========================================================================
   RedMoviSim — 2.6 · tools/calles-osm.mjs
   Genera js/city/realStreets.js: la CALLE REAL alrededor de un acceso del
   Metro, a partir de OpenStreetMap (© colaboradores de OpenStreetMap, ODbL).

   El juego no consulta OSM en vivo (tiene que andar sin conexión y en el APK):
   este script toma una «foto» de los datos y la deja ya convertida a metros,
   en las coordenadas locales de la calle del juego (city/plan.js · STREET):

     · la avenida de la estación queda a lo largo de Z y el acceso elegido,
       en la vereda +X, justo donde el juego pone la boca de la escalera
       (x = 9,6, la boca en z = +3,2), así sigue cayendo sobre la salida de
       la mezanina;
     · edificios con su planta real y su altura (height, building:levels o,
       si OSM no la tiene, una estimación reproducible), techos/marquesinas,
       calzadas con su ancho (lanes × 3,3 m o width), soleras, líneas de
       pista, pasos de cebra, semáforos, árboles, pasto, faroles;
     · pistas para los autos (siguen las calles reales, en su sentido) con
       los semáforos que encuentran;
     · dónde van los locales del juego (sobre fachadas reales de la vereda
       del Metro), el kiosko, el paradero (uno real) y el hito para la foto.

   Uso:   node tools/calles-osm.mjs              (descarga y escribe el archivo)
          node tools/calles-osm.mjs --ver        (solo muestra el resumen)
   Descarga con curl (respeta el proxy del sistema) de la API oficial de OSM
   (api.openstreetmap.org/api/0.6/map.json), una zona chica por estación.
   ========================================================================== */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

/** Estaciones con calle real. entrances: ids de nodos OSM, en orden de preferencia. */
const STATIONS = [
  {
    name: "UNIVERSIDAD DE CHILE",
    lat: -33.4441289, lon: -70.6506651,            // acceso E · Arturo Prat
    entrances: [6257072288, 6257072287, 6257072284, 6257072285, 10723170893],
    avenue: /Libertador Bernardo O'Higgins/,
    landmark: { way: 25018684 },                   // Casa Central de la Universidad de Chile
    radius: 230,
    // Alturas conocidas (m) de edificios sin altura en OSM
    heights: { 25018684: 17, 394238: 16, 114621538: 18, 12721099: 26, 24964144: 22, 11317315: 30, 11317398: 34,
      157650982: 9, 11352836: 40, 40221637: 42, 40222168: 34 },
  },
];

const ACCESS = { x: 9.6, z: 3.2 };                 // boca del acceso en la calle del juego
const LANE_W = 3.3;
const ROAD = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
  "living_street", "primary_link", "secondary_link", "tertiary_link", "service", "busway"]);
const DRIVE = new Set(["trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "primary_link", "secondary_link", "tertiary_link", "living_street"]);
const DEF_LANES = { trunk: 3, primary: 3, secondary: 2, tertiary: 2, unclassified: 2, residential: 2, living_street: 1, service: 1, busway: 1 };

const args = process.argv.slice(2);
const r1 = (v) => Math.round(v * 10) / 10;

function fetchOSM(lat, lon, R) {
  const dlat = R / 110574, dlon = R / (111320 * Math.cos(lat * Math.PI / 180));
  const bbox = [lon - dlon, lat - dlat, lon + dlon, lat + dlat].map(v => v.toFixed(6)).join(",");
  const url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${bbox}`;
  const out = execFileSync("curl", ["-sS", "-m", "120", "-A", "RedMoviSim-tools/1.0 (+https://www.redmovisim.cl)", url], { maxBuffer: 1 << 28 });
  return JSON.parse(out.toString());
}

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
const polyLen = (pts) => pts.reduce((s, p, i) => (i ? s + len(sub(p, pts[i - 1])) : 0), 0);
/** Intersección del rayo p + t·d con el segmento ab: t o null. */
function raySeg(p, d, a, b) {
  const e = sub(b, a), den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-9) return null;
  const w = sub(a, p), t = (w[0] * e[1] - w[1] * e[0]) / den, u = (w[0] * d[1] - w[1] * d[0]) / den;
  return t > 0 && u >= 0 && u <= 1 ? t : null;
}
function seeded(n) { let a = (n * 2654435761) >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function build(cfg) {
  const R = cfg.radius;
  const data = fetchOSM(cfg.lat, cfg.lon, R + 40);
  const nodes = new Map(), ways = new Map(), rels = [];
  for (const e of data.elements) {
    if (e.type === "node") nodes.set(e.id, e);
    else if (e.type === "way") ways.set(e.id, e);
    else rels.push(e);
  }
  const ent = cfg.entrances.map(id => nodes.get(id)).find(Boolean);
  if (!ent) throw new Error(`${cfg.name}: no está el acceso en los datos`);
  const lat0 = ent.lat, lon0 = ent.lon, kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110574;
  const en = (n) => [(n.lon - lon0) * kx, (n.lat - lat0) * ky];

  // Dirección de la avenida junto al acceso (en este/norte) y su sentido: el acceso queda a la DERECHA
  const avWays = [...ways.values()].filter(w => cfg.avenue.test(w.tags?.name || "") && ROAD.has(w.tags?.highway));
  let best = null;
  for (const w of avWays) for (let i = 0; i + 1 < w.nodes.length; i++) {
    const a = nodes.get(w.nodes[i]), b = nodes.get(w.nodes[i + 1]);
    if (!a || !b) continue;
    const pa = en(a), pb = en(b), c = closestOnSeg([0, 0], pa, pb), d = Math.hypot(c[0], c[1]);
    if (!best || d < best.d) best = { d, dir: norm(sub(pb, pa)), c };
  }
  let dir = best.dir;
  const right = (v) => [v[1], -v[0]];                       // derecha de quien avanza, en este/norte
  if (dot([-best.c[0], -best.c[1]], right(dir)) < 0) dir = [-dir[0], -dir[1]];
  const [de, dn] = dir;
  // este/norte → local (x a la derecha, −z adelante) con el acceso en la boca del juego
  const L = ([e, n]) => [e * dn - n * de + ACCESS.x, -(e * de + n * dn) + ACCESS.z];
  const P = (id) => { const n = nodes.get(id); return n ? L(en(n)) : null; };
  const near = (p, extra = 0) => Math.max(Math.abs(p[0] - ACCESS.x), Math.abs(p[1] - ACCESS.z)) < R + extra;
  const wayPts = (w) => w.nodes.map(P).filter(Boolean);

  /* ---------- Calzadas ---------- */
  const roads = [];
  for (const w of ways.values()) {
    const t = w.tags || {};
    if (!ROAD.has(t.highway) || t.area === "yes") continue;
    if (t.tunnel || t.covered === "yes" || +t.layer < 0 || t.indoor === "yes" || t.bridge) continue;
    if (t.highway === "service" && t.service && t.service !== "alley" && t.service !== "driveway") continue;
    const pts = wayPts(w);
    if (pts.length < 2 || !pts.some(p => near(p, 60))) continue;
    const lanes = +t.lanes || DEF_LANES[t.highway] || 2;
    const width = +t.width || Math.max(3.2, lanes * (t.highway === "service" || t.highway === "living_street" ? 3.0 : LANE_W));
    const oneway = t.oneway === "yes" || t.oneway === "1" || t.junction === "roundabout";
    const rev = t.oneway === "-1";
    roads.push({ id: w.id, pts: rev ? pts.reverse() : pts, nodes: rev ? [...w.nodes].reverse() : w.nodes, w: width, lanes, oneway: oneway || rev, hw: t.highway, name: t.name || "", bus: t.busway || t["lanes:bus"] ? 1 : 0, avenue: cfg.avenue.test(t.name || "") });
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
    let h = cfg.heights[id] || +String(t.height || "").replace(",", ".") || 0;
    const lv = +t["building:levels"];
    if (!h && lv) h = lv * 3.3 + 1.2;
    if (!h) {
      const lvls = [3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 10, 10, 12, 12, 14, 16, 18, 22];
      h = lvls[Math.floor(rnd() * lvls.length)] * 3.3 + 1.2;
      if (["church", "chapel", "cathedral"].includes(t.building) || t.amenity === "place_of_worship") h = 16;
      if (t.building === "garages" || t.building === "kiosk" || t.building === "shed") h = 4;
    }
    const levels = Math.max(1, Math.round((h - 1.2) / 3.3));
    const heritage = !!(t.heritage || t.historic || ["church", "civic", "government"].includes(t.building)) && levels <= 6;
    const style = heritage ? 1 : h > 45 && rnd() < 0.6 ? 2 : levels <= 3 ? 1 : 0;   // 0 oficinas · 1 clásico · 2 muro cortina
    buildings.push({ id, ring, h: r1(h), c: Math.floor(rnd() * palette), s: style, name: t.name || "" });
  };
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
      lanes.push({ p: lp.flatMap(q => [r1(q[0]), r1(q[1])]), sig, kind: r.hw, bus: r.avenue && k === 0 ? 1 : 0 });
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
  const lmB = buildings.find(b => b.id === cfg.landmark?.way);
  if (lmB) {
    // Punto del muro más cercano al acceso que mira a una calle; la foto se saca 5 m afuera
    let bestP = null;
    for (let i = 0; i < lmB.ring.length; i++) {
      const a = lmB.ring[i], c = lmB.ring[(i + 1) % lmB.ring.length];
      const m = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2], e = norm(sub(c, a)), nrm = [e[1], -e[0]];
      if (len(sub(c, a)) < 8) continue;
      const spot = [m[0] + nrm[0] * 5, m[1] + nrm[1] * 5];
      if (inBuilding(spot) || !near(spot, -10)) continue;
      const d = len(sub(spot, [ACCESS.x, ACCESS.z]));
      if (!bestP || d < bestP.d) bestP = { d, spot, wall: m, a: angOf(nrm) };
    }
    const xs = lmB.ring.map(p => p[0]), zs = lmB.ring.map(p => p[1]);
    if (bestP) landmark = { spot: bestP.spot.map(r1), wall: bestP.wall.map(r1), a: +bestP.a.toFixed(3), box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)].map(r1), id: lmB.id };
    lmB.lm = 1;
  }

  // Árboles que estorban la boca del acceso, el tótem, puertas o el paradero
  const keepFree = [[ACCESS.x, 0, 3.8], [ACCESS.x + 2, ACCESS.z + 0.7, 1.5], [busStop.x, busStop.z, 3.2], [kiosk.x, kiosk.z, 2.2], ...shops.map(s => [s.door[0], s.door[1], 1.4])];
  const freeOk = (x, z) => keepFree.every(([fx, fz, r]) => Math.hypot(x - fx, z - fz) > r);
  const treesOk = [];
  for (let i = 0; i < trees.length; i += 2) if (freeOk(trees[i], trees[i + 1])) treesOk.push(trees[i], trees[i + 1]);
  const lampsOk = lamps.filter(l => freeOk(l[0], l[1]));

  const flat = (pts) => pts.flatMap(p => [r1(p[0]), r1(p[1])]);
  const out = {
    entrance: ent.tags?.name || "", radius: R, rot: [+dn.toFixed(5), +de.toFixed(5)],
    buildings: buildings.map(b => [b.h, b.c, b.s, b.lm ? 1 : 0, ...flat(b.ring)]),
    roofs: roofs.map(r => [r.y, ...flat(r.ring)]),
    roads: roads.map(r => [r1(r.w), r.hw === "service" ? 1 : 0, ...flat(r.pts)]),
    curbs: curbs.map(flat), dashes: dashes.map(([a, b]) => [r1(a[0]), r1(a[1]), r1(b[0]), r1(b[1])]).flat(), center: center.map(flat),
    crossings, signals, lamps: lampsOk, trees: treesOk, grass: grass.map(flat), lanes,
    shops, kiosk, busStop, landmark,
  };
  const st = { edificios: buildings.length, techos: roofs.length, calles: roads.length, árboles: treesOk.length / 2, semáforos: signals.length, cruces: crossings.length, pistas: lanes.length, faroles: lampsOk.length, acceso: out.entrance, locales: shops.map(s => s.stand ? "puesto" : "fachada").join(","), paradero: busStop.real ? "real" : "estimado", hito: !!landmark };
  return { out, st };
}

const result = {};
for (const cfg of STATIONS) {
  const { out, st } = build(cfg);
  result[cfg.name] = out;
  console.log(cfg.name, st);
}
if (!args.includes("--ver")) {
  const body = `/* Generado por tools/calles-osm.mjs (${new Date().toISOString().slice(0, 10)}) — no editar a mano.
   Datos © colaboradores de OpenStreetMap (www.openstreetmap.org/copyright), licencia ODbL.
   Coordenadas locales de la calle del juego (metros, ver city/plan.js · STREET). */
export const OSM_ATTRIBUTION = "© colaboradores de OpenStreetMap";
export const REAL_STREETS = ${JSON.stringify(result)};
`;
  writeFileSync(new URL("../js/city/realStreets.js", import.meta.url), body);
  console.log(`js/city/realStreets.js · ${(body.length / 1024).toFixed(0)} KB`);
}
