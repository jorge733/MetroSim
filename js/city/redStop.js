/* ==========================================================================
   RedMoviSim — 2.21 · city/redStop.js
   PARADERO de Red como en la calle real, con los datos de OpenStreetMap
   (© colaboradores de OpenStreetMap, ODbL): la señal de parada con su
   código (PA167), el número de parada y el nombre («Parada 6 / (M)
   Universidad de Chile»), los recorridos que paran, el refugio (si lo hay)
   y la zona de detención pintada en la pista.

   Lo usan la calle de cada estación (city/city.js, los paraderos de OSM
   alrededor del acceso) y la calle del bus (bus/busWorld.js).

   Coordenadas del grupo: origen = el poste de la señal, a 0,6 m de la solera;
   la calzada queda hacia −X (la solera en x = −0,6) y la vereda hacia +X;
   el bus llega desde +Z y para con la puerta delantera junto a la paleta
   (en z = −2,4, delante del refugio).
   ========================================================================== */

import * as THREE from "three";
import { std, glow, addBox, makeCanvas, toTexture } from "../utils.js";

const RED = "#d7262e";

/** Insignia de un recorrido en la señal: blanca con el número en rojo (la señal misma es roja). */
export const routeColor = () => "#ffffff";

/** Nombre corto de un acceso: sin el nombre de la estación ni la letra («Universidad de Chile - E - Arturo Prat» → «Arturo Prat»). */
export function accessStreet(name = "", station = "", ref = "") {
  const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  let parts = name.split(/\s+-\s+/).map(p => p.trim()).filter(Boolean);
  parts = parts.filter(p => fold(p) !== fold(station) && !(ref && fold(p) === fold(ref)) && !/^acceso\s+\w$/i.test(p));
  return (parts.join(" · ") || "").replace(/^Acceso\s+[A-Z0-9]\s*[-·:]?\s*/i, "");
}

/**
 * Textura de la señal de parada (vertical): franja de «PARADA» con el número, código, nombre y la grilla de
 * recorridos. `play` = recorridos que se pueden tomar en el juego (van destacados con borde blanco).
 */
export function stopSignTexture({ ref = "", n = 0, name = "", routes = [], play = [] }) {
  const W = 320, rows = Math.ceil(Math.min(routes.length, 12) / 3);
  const H = 300 + Math.max(1, rows) * 64 + (routes.length > 12 ? 48 : 30);
  const c = makeCanvas(W, H), g = c.getContext("2d");
  // Panel rojo de Red con franja amarilla abajo (como las señales de los paraderos reales)
  g.fillStyle = RED; g.fillRect(0, 0, W, H);
  g.fillStyle = "#f2c230"; g.fillRect(0, H - 16, W, 16);
  g.fillStyle = "#1b1f24"; g.fillRect(0, 0, W, 112);
  g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = "800 52px Arial"; g.fillText(n ? `PARADA ${n}` : "PARADA", W / 2, 46);
  g.font = "700 30px Arial"; g.fillText(ref || "Paradero", W / 2, 92);
  // Nombre (hasta tres líneas)
  g.fillStyle = "#ffffff";
  const words = name.split(" "), lines = [];
  let cur = "";
  g.font = "700 30px Arial";
  for (const w of words) { const t = cur ? cur + " " + w : w; if (g.measureText(t).width > W - 30 && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  lines.slice(0, 3).forEach((l, i) => g.fillText(l, W / 2, 148 + i * 36));
  // Recorridos
  g.fillStyle = "#ffe3e3"; g.font = "600 22px Arial"; g.fillText(routes.length ? "RECORRIDOS" : "SIN RECORRIDOS", W / 2, 268);
  const shown = routes.slice(0, 12);
  shown.forEach((id, k) => {
    const x = 14 + (k % 3) * 100, y = 290 + Math.floor(k / 3) * 64;
    g.fillStyle = routeColor(id); g.fillRect(x, y, 92, 54);
    if (play.includes(id)) { g.strokeStyle = "#f2c230"; g.lineWidth = 7; g.strokeRect(x + 3, y + 3, 86, 48); }
    g.fillStyle = RED; g.font = `900 ${id.length > 4 ? 26 : 34}px Arial`; g.fillText(id, x + 46, y + 29);
  });
  if (routes.length > 12) { g.fillStyle = "#ffffff"; g.font = "600 20px Arial"; g.fillText(`y ${routes.length - 12} más`, W / 2, H - 30); }
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return { tex: t, aspect: W / H };
}

let SHARED = null;
function shared() {
  return SHARED ||= {
    post: std(0x5d656c, { metal: 0.5, rough: 0.4 }),
    frame: std(0x2f363d, { metal: 0.6, rough: 0.35 }),
    roof: std(0x39434d, { metal: 0.4, rough: 0.45 }),
    glass: std(0xbfd8e6, { metal: 0.2, rough: 0.05, transparent: true, opacity: 0.28, depthWrite: false }),
    seat: std(0x9aa3ab, { metal: 0.6, rough: 0.35 }),
    yellow: std(0xf2c230, { rough: 0.7 }),
  };
}

/**
 * Arma un paradero. `stop` = { ref, n, name, routes, shelter, bench }; `play` = recorridos del juego que paran aquí.
 * `paint`: la zona de detención amarilla en la pista (largo en m, o 0 para no pintarla).
 */
export function buildRedStop(parent, stop, { play = [], night = 0, paint = 12, lit = true } = {}) {
  const g = new THREE.Group();
  parent.add(g);
  const M = shared();
  // Señal de parada: poste con la placa (doble cara, se lee desde la calle en los dos sentidos)
  const pz = -2.4;                                      // la paleta va al frente del sitio, delante del refugio
  addBox(g, 0.09, 3.1, 0.09, M.post, 0, 1.55, pz);
  const { tex, aspect } = stopSignTexture({ ...stop, play });
  const h = 1.25, w = h * aspect;
  const mat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.55, emissive: new THREE.Color(0xffffff), emissiveMap: tex, emissiveIntensity: night ? 0.55 : 0.06 });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  plate.position.set(0.05 + w / 2, 3.05 - h / 2, pz + 0.02);
  g.add(plate);
  addBox(g, w + 0.04, h + 0.04, 0.03, M.frame, 0.05 + w / 2, 3.05 - h / 2, pz);
  // La misma cara del otro lado: la señal se lee viniendo de los dos sentidos
  const back = plate.clone();
  back.position.z = pz - 0.02;
  back.rotation.y = Math.PI;
  g.add(back);
  // Refugio: techo, paneles de vidrio atrás y a los lados, banca y el panel con el nombre en el techo
  if (stop.shelter) {
    const x0 = 0.6, x1 = 2.2, z0 = -1.2, z1 = 3.8, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, L = z1 - z0;
    addBox(g, x1 - x0 + 0.3, 0.1, L + 0.3, M.roof, cx - 0.1, 2.55, cz);
    for (const z of [z0 + 0.1, z1 - 0.1]) addBox(g, 0.08, 2.5, 0.08, M.frame, x1 - 0.05, 1.25, z);
    addBox(g, 0.04, 2.0, L - 0.2, M.glass, x1 - 0.05, 1.3, cz);
    for (const z of [z0 + 0.06, z1 - 0.06]) addBox(g, x1 - x0 - 0.3, 1.9, 0.04, M.glass, cx + 0.15, 1.3, z);
    addBox(g, 0.42, 0.05, 2.6, M.seat, x1 - 0.32, 0.5, cz);
    for (const z of [cz - 1.1, cz + 1.1]) addBox(g, 0.05, 0.5, 0.05, M.frame, x1 - 0.32, 0.25, z);
    if (lit && night) addBox(g, 0.5, 0.03, L - 0.6, glow(0xfff2d6), cx - 0.1, 2.49, cz);
    // Banda negra del techo, hacia la calle: «Nombre | Parada n» y el código
    const label = [stop.name, stop.n ? `Parada ${stop.n}` : ""].filter(Boolean).join("  |  ");
    const c = makeCanvas(1024, 96), q = c.getContext("2d");
    q.fillStyle = "#16181b"; q.fillRect(0, 0, 1024, 96);
    q.fillStyle = "#fff"; q.textAlign = "left"; q.textBaseline = "middle";
    let size = 54; q.font = `800 ${size}px Arial`;
    while (q.measureText(label).width > 800 && size > 26) { size -= 4; q.font = `800 ${size}px Arial`; }
    q.fillText(label, 24, 50);
    q.fillStyle = RED; q.fillRect(870, 14, 130, 68);
    q.fillStyle = "#fff"; q.textAlign = "center"; q.font = "900 40px Arial"; q.fillText(stop.ref || "", 935, 50);
    const t = toTexture(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    const band = new THREE.Mesh(new THREE.PlaneGeometry(L, L * 96 / 1024), glow(0xffffff, { map: t }));
    band.position.set(x0 - 0.36, 2.55, cz);
    band.rotation.y = -Math.PI / 2;
    g.add(band);
  } else if (stop.bench) {
    addBox(g, 0.42, 0.05, 1.8, M.seat, 1.6, 0.5, 1.2);
    for (const z of [0.5, 1.9]) addBox(g, 0.05, 0.5, 0.05, M.frame, 1.6, 0.25, z);
  }
  // Solera pintada de amarillo a lo largo del sitio de detención (12 m por bus): ahí no se estaciona
  if (paint > 0) {
    const curb = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.05, paint), M.yellow);
    curb.position.set(-0.62, 0.035, paint / 2 - 3);
    g.add(curb);
  }
  return g;
}

/** Huella del paradero en coordenadas del grupo (para no caminar a través del refugio): [cx, cz, hx, hz]. */
export const STOP_FOOTPRINT = { shelter: [1.45, 1.3, 0.85, 2.6], pole: [0, -2.4, 0.15, 0.15] };
