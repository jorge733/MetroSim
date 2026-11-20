/* ==========================================================================
   MetroSim — Alpha 0.9 · city/city.js
   La CALLE de la estación: lo que ve el Pasajero al salir del Metro.

   · Avenida de doble sentido con veredas, faroles, autos y micros.
   · Vereda este: la boca del acceso al Metro, el kiosko y los locales del
     plan (panadería, almacén, farmacia, cajero...), con su letrero.
   · Lado oeste: el HITO de la estación (city/landmarks.js) o, si la
     estación no tiene, edificios genéricos.
   · Peatones que caminan por las veredas.
   · Cielo, sol y faroles según la hora real del juego (día, atardecer, noche).
   · Sonidos de ciudad: autos y micros que pasan, bocinas, pájaros de día y
     alguna sirena lejana (avisa por this.sound; los produce audio.js).

   Solo existe UNA calle a la vez (la de la estación donde estás): al salir
   en otra estación se descarga la anterior y se construye la nueva.

   Se dibuja JUSTO ENCIMA de la estación (config.js · CONFIG.exit): la boca
   del acceso queda sobre la escalera de salida de la mezanina, y se sale o
   se entra al Metro caminando, sin teletransporte. Las coordenadas del
   jugador son del mundo, y aquí se pasan a locales (lx, lz).
   Mientras el pasajero sube hacia la calle, la luz del día y el cielo
   aparecen de a poco (setOutdoor).
   ========================================================================== */

import * as THREE from "three";
import { std, glow, addBox, makeCanvas, toTexture } from "../utils.js";
import { CONFIG, LINE, LINE_COLORS, lineSign } from "../config.js";
import { STREET, streetPlan, seededRandom } from "./plan.js";
import { skyAt } from "../render/outdoor.js";            // cielo según la hora y el tiempo (1.5: nublado, lluvia)
import { buildLandmark } from "./landmarks.js";
import { cityMaterials, genericBuilding, signMaterial, facingPlane, streetLamp, tree, bench, addMesh } from "./kit.js";
import { markCity } from "../render/trackLift.js";
import { carGroup, pickCarKind, streetBusGroup, CAR_COLORS } from "../render/vehicles.js";   // 2.21
import { SkyDome, SunShadow, sunDirection, lampPool } from "../render/realism.js";
import { BUS_METRO_STOPS, busRoutesAt } from "../bus/busRoute.js";
import { REAL_STREETS, OSM_ATTRIBUTION } from "./realStreets.js";      // 2.6 · calles reales (OpenStreetMap)
import { realStreetData, loadRealStreet } from "./streetData.js";      // 2.7 · se cargan cuando hacen falta
import { RealStreet, sampleLane, HOLE_MASK } from "./realCity.js";
import { buildRedStop, accessStreet } from "./redStop.js";              // 2.21 · paraderos y accesos con sus datos reales
import { ShopInterior, INSIDE, ENTERABLE } from "./shopInterior.js";   // 2.17 · se entra caminando a los locales

/** 1.15 · Paradero de la calle (local): aquí se toma el bus del recorrido si pasa por esta estación. */
const BUS_STOP = { x: STREET.roadHalf + 1.5, z: 34 };
import { key as keyText } from "../keys.js";

const S = STREET;
/** Origen de la calle en el mundo: justo encima de la estación, con la boca del acceso sobre su escalera de salida. */
const EXIT = CONFIG.exit;
const originOf = (st) => ({ x: EXIT.streetX, y: EXIT.streetY, z: st.z + EXIT.streetDz });

/** Logotipo del Metro de Santiago (óvalo con tres rombos rojos) para el tótem. */
function metroLogoTexture() {
  const c = makeCanvas(512, 368), g = c.getContext("2d");
  g.fillStyle = "#f4f4f2"; g.fillRect(0, 0, 512, 368);
  g.fillStyle = "#ffffff"; g.strokeStyle = "#3d4248"; g.lineWidth = 22;
  g.beginPath(); g.ellipse(256, 150, 200, 122, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = "#e1251b";
  for (const cx of [160, 256, 352]) {
    g.beginPath(); g.moveTo(cx, 66); g.lineTo(cx + 46, 150); g.lineTo(cx, 234); g.lineTo(cx - 46, 150); g.closePath(); g.fill();
  }
  g.fillStyle = "#1b1f24"; g.font = "900 70px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("METRO", 256, 325);
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Insignias circulares de las líneas que pasan por la estación (la activa y sus combinaciones). */
function lineBadgesTexture(ids) {
  const s = 128, c = makeCanvas(s * ids.length + 32, s + 16), g = c.getContext("2d");
  g.fillStyle = "#1b1f24"; g.fillRect(0, 0, c.width, c.height);
  ids.forEach((id, i) => {
    const cx = 16 + s * i + s / 2, cy = c.height / 2;
    g.fillStyle = LINE_COLORS[id] || "#888"; g.beginPath(); g.arc(cx, cy, s * 0.42, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#ffffff"; g.font = `900 ${id.length > 2 ? 34 : id.length > 1 ? 50 : 66}px Arial`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(lineSign(id), cx, cy + 3);
  });
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/**
 * 1.20 · Acceso al Metro para cualquier vereda (lo usa la calle del bus, js/bus/busWorld.js): la misma boca
 * revestida, baranda de acero y vidrio, franja podotáctil y tótem del Metro de Santiago que las calles
 * de las estaciones (City.buildAccess). Origen = centro de la boca, al nivel de la vereda; la escalera baja
 * hacia −Z. Quien lo use debe dejar un hueco de w × len en la vereda.
 * @param {{name:string, lines:string[], night?:number, w?:number, len?:number}} o
 */
export function metroStreetAccess(parent, { name, lines, night = 0, w = 1.9, len = 5.2, ref = "", street = "", lift = false }) {
  const g = new THREE.Group();
  parent.add(g);
  const M = cityMaterials(night);
  const granite = std(0x8d8a86, { rough: 0.55 });
  const tile = std(0xe9e4da, { rough: 0.35 });
  const steel = std(0xd5dade, { metal: 0.85, rough: 0.25 });
  const x0 = -w / 2, x1 = w / 2, z0 = -len / 2, z1 = len / 2;
  const n = 14, rise = 3.0 / n, run = (len - 0.9) / n;
  for (let i = 0; i < n; i++) {
    const z = z1 - 0.2 - run * (i + 0.5), y = -rise * (i + 1);
    addBox(g, w - 0.1, rise, run, granite, 0, y + rise / 2, z);
    addBox(g, w - 0.1, 0.02, 0.05, M.yellow, 0, y + rise + 0.01, z + run / 2 - 0.03);
  }
  addBox(g, w, 0.1, 1.2, granite, 0, -3.05, z0 + 0.6);
  addBox(g, 0.12, 3.3, len, tile, x0 + 0.06, -1.55, 0);
  addBox(g, 0.12, 3.3, len, tile, x1 - 0.06, -1.55, 0);
  addBox(g, w, 3.3, 0.12, tile, 0, -1.55, z0 + 0.06);
  const down = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.3, 0.42), signMaterial("↓  METRO", { bg: "#1b1f24", font: "800 84px Arial", w: 512 }));
  down.position.set(0, -0.3, z0 + 0.13);
  g.add(down);
  addBox(g, w - 0.4, 0.05, 0.25, glow(0xfff0c8), 0, -0.55, z0 + 0.3);
  accessParapet(g, { w, len, cx: 0, cz: 0, y0: 0, name, ref, color: LINE_COLORS[lines[0]] });
  addBox(g, w, 0.02, 0.4, M.yellow, 0, 0.01, z1 + 0.25);
  metroTotem(g, name, lines, x1 + 0.75, z1 + 0.7, { ref, street });
  if (lift) metroLift(g, x0 - 1.35, z1 - 0.9, ref);
  // 2.21 · Máscara invisible en la boca: el piso que pasa por debajo no tapa la escalera
  const mask = new THREE.Mesh(new THREE.PlaneGeometry(w, len), HOLE_MASK);
  mask.rotation.x = -Math.PI / 2;
  mask.position.y = 0.12;
  mask.renderOrder = -2;
  g.add(mask);
  return g;
}

/**
 * 2.21 · Remate de la boca como en los accesos reales: muro-parapeto de hormigón de ~1,05 m en tres lados con un
 * tubo de acero encima, y sobre el lado cerrado la banda del color de la línea con el nombre de la estación y la
 * letra del acceso en un círculo blanco. (cx, cz) = centro de la boca; baja hacia −Z, abierta hacia +Z.
 */
export function accessParapet(g, { w, len, cx = 0, cz = 0, y0 = 0, name = "", ref = "", color = "#d7262e" }) {
  const concrete = std(0xa8a49c, { rough: 0.85 });
  const cap = std(0x8d8a86, { rough: 0.55 });
  const steel = std(0xd5dade, { metal: 0.85, rough: 0.25 });
  const H = 1.05, T = 0.2;
  const x0 = cx - w / 2 - T / 2, x1 = cx + w / 2 + T / 2, z0 = cz - len / 2 - T / 2, z1 = cz + len / 2;
  for (const x of [x0, x1]) {
    addBox(g, T, H, len + T, concrete, x, y0 + H / 2, cz - T / 2);
    addBox(g, T + 0.06, 0.06, len + T + 0.06, cap, x, y0 + H + 0.03, cz - T / 2);
    addBox(g, 0.05, 0.05, len + T, steel, x, y0 + H + 0.22, cz - T / 2);
    for (let z = z0 + 0.1; z <= z1 + 0.01; z += (len + T) / 3) addBox(g, 0.04, 0.2, 0.04, steel, x, y0 + H + 0.12, z);
  }
  addBox(g, w + 2 * T, H, T, concrete, cx, y0 + H / 2, z0);
  addBox(g, w + 2 * T + 0.06, 0.06, T + 0.06, cap, cx, y0 + H + 0.03, z0);
  // Banda del color de la línea sobre el lado cerrado (se lee desde la boca y desde atrás)
  const c = makeCanvas(1024, 160), q = c.getContext("2d");
  q.fillStyle = color; q.fillRect(0, 0, 1024, 160);
  q.fillStyle = "#ffffff"; q.textBaseline = "middle"; q.textAlign = "left";
  let x = 40;
  if (ref) {
    q.beginPath(); q.arc(90, 80, 58, 0, Math.PI * 2); q.fill();
    q.fillStyle = color; q.font = "900 80px Arial"; q.textAlign = "center"; q.fillText(ref, 90, 84);
    q.fillStyle = "#ffffff"; q.textAlign = "left"; x = 175;
  }
  let size = 84; q.font = `800 ${size}px Arial`;
  while (q.measureText(name).width > 1024 - x - 30 && size > 30) { size -= 4; q.font = `800 ${size}px Arial`; }
  q.fillText(name, x, 86);
  const t = toTexture(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  const bw = w + 2 * T, bh = bw * 160 / 1024;
  const band = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.06), [steel, steel, steel, steel, glow(0xffffff, { map: t }), glow(0xffffff, { map: t })]);
  band.position.set(cx, y0 + H + 0.06 + bh / 2, z0);
  g.add(band);
  for (const sx of [-1, 1]) addBox(g, 0.05, 0.1, 0.05, steel, cx + sx * (bw / 2 - 0.1), y0 + H + 0.08, z0);
}

/**
 * 2.21 · Placa del acceso (bajo las insignias del tótem): la letra del acceso, como en los accesos reales («Acceso A»),
 * y la calle a la que da.
 */
function accessPlateTexture(ref, street) {
  const c = makeCanvas(512, 128), g = c.getContext("2d");
  g.fillStyle = "#1b1f24"; g.fillRect(0, 0, 512, 128);
  g.textBaseline = "middle";
  let x = 16;
  if (ref) {
    g.fillStyle = "#ffffff"; g.fillRect(12, 12, 104, 104);
    g.fillStyle = "#1b1f24"; g.font = "900 84px Arial"; g.textAlign = "center"; g.fillText(ref, 64, 68);
    x = 132;
  }
  g.fillStyle = "#ffffff"; g.textAlign = "left";
  g.font = "700 34px Arial"; g.fillText(ref ? `Acceso ${ref}` : "Acceso", x, street ? 40 : 66);
  if (street) {
    let size = 36; g.font = `800 ${size}px Arial`;
    while (g.measureText(street).width > 512 - x - 12 && size > 18) { size -= 2; g.font = `800 ${size}px Arial`; }
    g.fillText(street, x, 88);
  }
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** 2.21 · Ascensor del acceso (cuando OSM dice que tiene): cabina de vidrio con el pictograma de accesibilidad. */
export function metroLift(parent, x, z, ref = "") {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  parent.add(g);
  const frame = std(0xc9ced3, { metal: 0.85, rough: 0.25 });      // pabellón de acero inoxidable con alero
  const glass = std(0xbfd8e6, { metal: 0.2, rough: 0.05, transparent: true, opacity: 0.3, depthWrite: false });
  addBox(g, 2.1, 0.14, 2.1, frame, 0, 2.77, 0);
  for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) addBox(g, 0.1, 2.7, 0.1, frame, dx, 1.35, dz);
  addBox(g, 1.6, 2.6, 1.6, glass, 0, 1.35, 0);
  const c = makeCanvas(256, 128), q = c.getContext("2d");
  q.fillStyle = "#1a5fb4"; q.fillRect(0, 0, 256, 128);
  q.fillStyle = "#fff"; q.font = "900 70px Arial"; q.textAlign = "center"; q.textBaseline = "middle";
  q.fillText("♿", 48, 68); q.font = "800 36px Arial"; q.fillText("Ascensor", 160, 52); q.font = "700 28px Arial"; q.fillText(ref ? `Acceso ${ref}` : "Metro", 160, 92);
  const t = toTexture(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  const sign = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 0.04), glow(0xffffff, { map: t }));
  sign.position.set(0, 3.1, 0.86);
  g.add(sign);
  const back = sign.clone(); back.position.z = -0.86; back.rotation.y = Math.PI; g.add(back);
  return g;
}

/** Tótem del Metro de Santiago: logotipo retroiluminado, nombre de la estación e insignias de sus líneas. */
export function metroTotem(parent, name, lines, x = 0, z = 0, { ref = "", street = "" } = {}) {
  const totem = new THREE.Group();
  totem.position.set(x, 0, z);
  parent.add(totem);
  const granite = std(0x8d8a86, { rough: 0.55 });
  const dark = std(0x2b2f34, { metal: 0.5, rough: 0.45 });
  addBox(totem, 0.5, 0.12, 0.5, granite, 0, 0.07, 0);
  addBox(totem, 0.22, 4.1, 0.22, dark, 0, 2.05, 0);
  const face = (w, h, mat, y, depth = 0.24) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(depth, h, w), [mat, mat, dark, dark, dark, dark]);
    m.position.y = y;
    totem.add(m);
    return m;
  };
  face(1.25, 0.9, glow(0xffffff, { map: metroLogoTexture() }), 4.05, 0.3);
  addBox(totem, 0.34, 0.06, 1.33, dark, 0, 4.53, 0);
  face(1.7, 0.36, signMaterial(name, { bg: "#1b1f24", font: "800 76px Arial" }), 3.35);
  if (lines.length) face(0.36 * lines.length + 0.1, 0.36, glow(0xffffff, { map: lineBadgesTexture(lines) }), 2.92);
  if (ref || street) face(1.6, 0.4, glow(0xffffff, { map: accessPlateTexture(ref, street) }), 2.45);
  return totem;
}

/** 2.21 · ¿El punto (lx, lz) toca el obstáculo b (con margen m)? Los obstáculos girados (accesos y paraderos reales) llevan `rot`. */
function hitBlock(b, lx, lz, m) {
  if (lx < b.x0 - m || lx > b.x1 + m || lz < b.z0 - m || lz > b.z1 + m) return false;
  const r = b.rot;
  if (!r) return true;
  const dx = lx - r.cx, dz = lz - r.cz, u = dx * r.c - dz * r.s, v = dx * r.s + dz * r.c;
  return Math.abs(u) < r.hx + m && Math.abs(v) < r.hz + m;
}
/** Obstáculo girado: rectángulo de semiejes hx (x local) × hz (z local) con centro (cx, cz) y giro a (como rotation.y). */
function rotBlock(cx, cz, a, hx, hz) {
  const c = Math.cos(a), s = Math.sin(a), ex = Math.abs(c) * hx + Math.abs(s) * hz, ez = Math.abs(s) * hx + Math.abs(c) * hz;
  return { x0: cx - ex, x1: cx + ex, z0: cz - ez, z1: cz + ez, rot: { cx, cz, c, s, hx, hz } };
}

const LANES = [{ x: -5.2, dir: 1 }, { x: -1.9, dir: 1 }, { x: 1.9, dir: -1 }, { x: 5.2, dir: -1 }];

export class City {
  /** @param {THREE.WebGLRenderer} [renderer] 2.4 · para las sombras del sol */
  constructor(scene, renderer = null) {
    this.scene = scene;
    this.renderer = renderer;
    this.group = null;
    this.active = false;
    this.station = null;
    this.timeT = 0;
    /** (tipo, datos) => void · sonidos puntuales de la calle (lo conecta main.js con audio.js) */
    this.sound = null;
    this.hornT = 8; this.birdT = 3; this.sirenT = 60;
  }

  /* ---------------------------------------------------------------------
     Carga / descarga
     --------------------------------------------------------------------- */

  /** Construye la calle de una estación (descarta la anterior). */
  load(station, clock) {
    if (this.station === station && this.group) { this.setTime(clock); return; }
    this.unload();
    this.station = station;
    this.lastClock = clock;
    // 2.7 · La calle real se descarga aparte: si todavía no llegó, se arma la de siempre y se cambia apenas llegue
    // (mientras el pasajero siga bajo tierra)
    const realData = realStreetData(station.name);
    if (REAL_STREETS[station.name] && !realData) {
      loadRealStreet(station.name).then(ok => {
        if (ok && this.station === station && !this.real && (this.outdoor || 0) < 0.05) { this.unload(); this.load(station, this.lastClock); }
      });
    }
    this.plan = streetPlan(station, { real: !!realData });
    this.sky = skyAt(clock);
    const night = this.sky.night;
    const M = this.M = cityMaterials(night);
    const rnd = seededRandom(station.name + "#city");
    const g = this.group = new THREE.Group();
    this.origin = originOf(station);
    g.position.set(this.origin.x, this.origin.y, this.origin.z);
    g.visible = (this.outdoor || 0) > 0;
    this.scene.add(g);
    this.blocks = [];                       // rectángulos no transitables (coordenadas locales)
    this.doors = [];                        // 2.17 · puertas automáticas de los locales
    this.inside = null;
    this.walkRects = [{ x0: -S.walkHalf + 0.35, x1: S.walkHalf - 0.35, z0: -S.halfLen, z1: S.halfLen }];
    this.real = realData ? new RealStreet(realData) : null;
    this.busStopAt = BUS_STOP;

    if (this.real) {
      // 2.6 · La calle real: edificios, calzadas, árboles y semáforos de OpenStreetMap
      const R = realData.radius - 15;
      this.walkRects = [{ x0: S.access.x - R, x1: S.access.x + R, z0: S.access.mouthZ - R, z1: S.access.mouthZ + R }];
      this.real.build(g, M, { night, access: S.access, landmarkColor: this.plan.landmark?.color });
      this.buildAccess(g, M);
      this.buildRealShops(g, M);
      this.buildRealLandmark(g, M);
      // 2.15.2 · Si el paradero del script cayó en un cruce o en un edificio, se corre a la vereda más cercana
      const k = realData.kiosk;
      const b = this.real.placeBusStop(realData.busStop, [[k.x, k.z, 1.8], ...realData.shops.map(s => [s.door[0], s.door[1], 1.2])]);
      this.busStopAt = { x: b.x, z: b.z };
      this.buildMainStop(g, b);
      this.buildRealAccesses(g);
      this.buildRealStops(g);
      this.buildRealVehicles(g, rnd);
      this.buildPedestrians(g, rnd);
    } else {
      this.buildGround(g, M);
      this.buildAccess(g, M);
      this.buildEastSide(g, M, rnd, night);
      this.buildWestSide(g, M, rnd, night);
      this.buildFurniture(g, M, rnd);
      this.buildBackdrop(g, M, rnd, night);
      this.buildVehicles(g, rnd);
      this.buildPedestrians(g, rnd);
    }

    // Luz del día: hemisférica + sol (solo existen mientras hay calle)
    this.hemi = new THREE.HemisphereLight(0xcfe4ff, 0x4a4238, 1);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 1);
    this.sun.position.set(-60, 120, 40);
    this.sun.target.position.set(0, 0, 0);
    g.add(this.hemi, this.sun, this.sun.target);
    // 2.4 · Cielo con degradado, sol y nubes; sombras del sol que siguen al pasajero
    this.dome = new SkyDome();
    g.add(this.dome);
    this.sunDir = sunDirection(clock);
    if (this.renderer) {
      this.shadow = new SunShadow(this.renderer, this.sun, { range: 55 });
      // La sombra se calcula sin doblar con la vía, igual que la calle (render/trackLift.js)
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      depth.userData.trackLift = "city";
      g.traverse(o => {
        if (!o.isMesh || o === this.dome) return;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        const solid = m && !m.transparent && !m.isMeshBasicMaterial;
        o.castShadow = solid;
        o.receiveShadow = !!m && !m.isMeshBasicMaterial;
        if (solid) o.customDepthMaterial = depth;
      });
    }
    this.setTime(clock);
    markCity(g);                            // la calle es horizontal: no se dobla con la vía (render/trackLift.js)
  }

  unload() {
    if (!this.group) return;
    this.inside?.dispose();
    this.inside = null;
    this.doors = [];
    this.scene.remove(this.group);
    this.sun?.shadow?.dispose();                    // 2.16.3 · el mapa de sombras del sol (2048²) quedaba en cada calle visitada
    this.shadow = null;
    this.group.traverse(o => {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      mats.forEach(m => { m.map?.dispose(); m.dispose(); });
      o.customDepthMaterial?.dispose();
    });
    this.group = null;
    this.station = null;
  }

  /** El jugador está en la calle: cielo de día o de noche en vez del túnel. */
  enter() { this.setOutdoor(1); }

  /** El jugador está bajo tierra, lejos de la salida: la calle no se dibuja. */
  leave() { this.setOutdoor(0); }

  /**
   * Cuánto "afuera" está el jugador (0 = en la estación … 1 = en la calle).
   * Mientras sube por la escalera de salida la calle ya se ve por la boca y
   * la luz del día, el cielo y la niebla pasan poco a poco del Metro a la calle.
   */
  setOutdoor(f) {
    if (!this.base) this.base = { bg: this.scene.background.clone(), fog: this.scene.fog.color.clone(), near: this.scene.fog.near, far: this.scene.fog.far };
    this.outdoor = f;
    this.active = f >= 1;
    if (this.group) this.group.visible = f > 0;
    this.applySky();
  }

  /** Fondo, niebla y luces según la hora y cuánto afuera está el jugador. */
  applySky() {
    const f = this.outdoor || 0, sky = this.sky;
    if (!this.base || !sky) return;
    const horizon = this.dome ? this.dome.set(sky, this.sunDir) : sky.color;
    this.dome?.setOpacity(f);
    this.scene.background.copy(this.base.bg).lerp(horizon, f);
    this.scene.fog.color.copy(this.base.fog).lerp(horizon, f);
    this.scene.fog.near = this.base.near + (70 - this.base.near) * f;
    this.scene.fog.far = this.base.far + (330 - this.base.far) * f;
    if (this.hemi && this.inside) {                        // 2.17 · dentro de un local: luz pareja de las luminarias
      this.hemi.color.setHex(0xfff6ea); this.hemi.groundColor.setHex(0x8a8274);
      this.hemi.intensity = 1.9;
      this.sun.intensity = 0;
    } else if (this.hemi) {
      this.hemi.color.setHex(0xcfe4ff); this.hemi.groundColor.setHex(0x4a4238);
      const k = f > 0 ? 0.5 + 0.5 * f : 0;               // la luz del día entra por la boca del acceso
      this.hemi.intensity = (0.25 + 0.75 * sky.day * (1 - 0.3 * sky.cloud)) * k;
      this.sun.intensity = 2.8 * sky.light * k;
      this.sun.color.setHex(sky.dusk > 0.4 ? 0xffb37a : 0xfff1dc);
    }
  }

  /** Ajusta el cielo y el sol a la hora del juego. */
  setTime(clock) {
    this.lastClock = clock;
    this.sky = skyAt(clock);
    this.sunDir = sunDirection(clock, this.sunDir);
    this.real?.toLocal(this.sunDir);        // 2.6 · en la calle real la avenida no va de norte a sur: el sol se gira con ella
    this.applySky();
  }

  /* ---------------------------------------------------------------------
     Construcción
     --------------------------------------------------------------------- */

  buildGround(g, M) {
    const L = 2 * 330;
    addBox(g, S.roadHalf * 2, 0.1, L, M.asphalt, 0, -0.05, 0);
    [-1, 1].forEach(s => {
      if (s < 0) addBox(g, S.walkHalf - S.roadHalf, 0.2, L, M.sidewalk, s * (S.roadHalf + S.walkHalf) / 2, 0.0, 0);   // vereda (borde a y = 0,1)
      addBox(g, 0.3, 0.22, L, M.curb, s * (S.roadHalf + 0.15), 0.0, 0);
    });
    // Líneas de pista y bandejón central
    addBox(g, 0.5, 0.18, L, M.curb, 0, 0.0, 0);
    for (let z = -330; z < 330; z += 9) [-3.55, 3.55].forEach(x => addBox(g, 0.15, 0.02, 4, M.paint, x, 0.01, z));
    // Pasos de cebra junto al acceso y en los extremos
    for (const cz of [-16, 16, -84, 84]) for (let x = -6.4; x <= 6.4; x += 1.1) addBox(g, 0.6, 0.02, 3.2, M.paint, x, 0.012, cz);
    // Vereda este con el hueco de la escalera del Metro
    const a = S.access, hx0 = a.x - a.halfX, hx1 = a.x + a.halfX, hz0 = a.z - a.halfZ, hz1 = a.z + a.halfZ;
    const span = (xa, xb, za, zb) => addBox(g, xb - xa, 0.2, zb - za, M.sidewalk, (xa + xb) / 2, 0.0, (za + zb) / 2);
    span(S.roadHalf, S.walkHalf, -L / 2, hz0);
    span(S.roadHalf, S.walkHalf, hz1, L / 2);
    span(S.roadHalf, hx0, hz0, hz1);
    span(hx1, S.walkHalf, hz0, hz1);
    // Suelo lejano (para que el horizonte no quede vacío), sin tapar el pozo de la escalera
    [-1, 1].forEach(side => addBox(g, 430, 0.1, L, std(0x5b5a55, { rough: 1 }), side * (S.walkHalf + 215), -0.2, 0));
  }

  /**
   * Acceso al Metro: escalera revestida que baja hacia la mezanina (muros de
   * cerámica, pasamanos, descanso iluminado con cartel), baranda de acero y
   * vidrio, franja podotáctil en la boca y tótem del Metro de Santiago con el
   * logotipo retroiluminado, el nombre de la estación y sus líneas.
   */
  buildAccess(g, M) {
    const a = S.access;
    const x0 = a.x - a.halfX, x1 = a.x + a.halfX, z0 = a.z - a.halfZ, z1 = a.z + a.halfZ;
    const W = a.halfX * 2, L = a.halfZ * 2;
    const granite = std(0x8d8a86, { rough: 0.55 });
    const tile = std(0xe9e4da, { rough: 0.35 });
    const steel = std(0xd5dade, { metal: 0.85, rough: 0.25 });

    // Peldaños de granito con nariz amarilla (bajan hacia −Z)
    const n = 14, rise = 3.0 / n, run = (L - 0.9) / n;
    for (let i = 0; i < n; i++) {
      const z = z1 - 0.2 - run * (i + 0.5), y = -rise * (i + 1);
      addBox(g, W - 0.1, rise, run, granite, a.x, y + rise / 2, z);
      addBox(g, W - 0.1, 0.02, 0.05, M.yellow, a.x, y + rise + 0.01, z + run / 2 - 0.03);
    }
    addBox(g, W, 0.1, 1.2, granite, a.x, -3.05, z0 + 0.6);                     // descanso
    // Muros revestidos del pozo de la escalera. Desde el descanso la escalera
    // sigue bajando hacia la mezanina (world.js · buildExitPassage), así que
    // no hay muro de fondo: solo una viga con el cartel, colgada sobre el paso.
    addBox(g, 0.12, 3.3, L, tile, x0 + 0.06, -1.55, a.z);
    addBox(g, 0.12, 3.3, L, tile, x1 - 0.06, -1.55, a.z);
    addBox(g, W, 0.5, 0.2, tile, a.x, -0.05, z0 + 0.1);
    const down = signMaterial("↓  METRO · " + this.station.name, { bg: "#1b1f24", font: "800 64px Arial" });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.3, 0.42), down);
    back.position.set(a.x, -0.3, z0 + 0.21);
    g.add(back);
    addBox(g, W - 0.4, 0.05, 0.25, M.lampOn, a.x, -0.55, z0 + 0.3);           // luminaria del descanso
    // Pasamanos interiores (bajan con la escalera)
    [x0 + 0.2, x1 - 0.2].forEach(x => {
      const h = addBox(g, 0.05, 0.05, Math.hypot(L - 0.9, 3), steel, x, -1.5 + 0.9, a.z + 0.25);
      h.rotation.x = Math.atan2(3, L - 0.9);
    });

    // 2.21 · Muro-parapeto con tubo de acero y la banda del color de la línea con la letra del acceso real
    accessParapet(g, { w: W, len: L, cx: a.x, cz: a.z, y0: 0.1, name: this.station.name, ref: this.real?.d.access?.ref || "", color: LINE.color || LINE_COLORS[LINE.id] });
    // Franja podotáctil amarilla delante de la boca
    addBox(g, W, 0.02, 0.4, M.yellow, a.x, 0.115, z1 + 0.25);
    this.blocks.push({ x0: x0 - 0.3, x1: x1 + 0.3, z0: z0 - 0.3, z1: z1 - 1.0 });   // el último metro de la boca se puede pisar para bajar
    // 2.21 · Máscara de la boca: el suelo lejano (que pasa por debajo) no tapa la escalera
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(W, L), HOLE_MASK);
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(a.x, 0.12, a.z);
    hole.renderOrder = -2;
    g.add(hole);

    // Tótem del Metro de Santiago
    const tx = x1 + 0.75, tz = z1 + 0.7;
    const totem = new THREE.Group();
    totem.position.set(tx, 0, tz);
    g.add(totem);
    const dark = std(0x2b2f34, { metal: 0.5, rough: 0.45 });
    addBox(totem, 0.5, 0.12, 0.5, granite, 0, 0.17, 0);
    addBox(totem, 0.22, 4.1, 0.22, dark, 0, 2.15, 0);
    const logoMat = glow(0xffffff, { map: metroLogoTexture() });
    const face = (w, h, mat, y, depth = 0.24) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(depth, h, w), [mat, mat, dark, dark, dark, dark]);
      m.position.y = y;
      totem.add(m);
      return m;
    };
    face(1.25, 0.9, logoMat, 4.15, 0.3);                                      // logotipo retroiluminado
    addBox(totem, 0.34, 0.06, 1.33, dark, 0, 4.63, 0);
    face(1.7, 0.36, signMaterial(this.station.name, { bg: "#1b1f24", font: "800 76px Arial" }), 3.45);
    const lines = [LINE.id, ...(this.station.combos || [])];
    face(0.36 * lines.length + 0.1, 0.36, glow(0xffffff, { map: lineBadgesTexture(lines) }), 3.02);
    // 2.21 · La letra del acceso real y la calle a la que da
    const acc = this.real?.d.access;
    if (acc && (acc.ref || acc.name)) face(1.6, 0.4, glow(0xffffff, { map: accessPlateTexture(acc.ref, accessStreet(acc.name, this.station.name, acc.ref)) }), 2.55);
    this.blocks.push({ x0: tx - 0.3, x1: tx + 0.3, z0: tz - 0.3, z1: tz + 0.3 });
    if (acc?.lift) {
      // Ascensor junto a la boca, si cabe en la vereda
      const lx = x0 - 1.4, lz = z1 - 1.2;
      if (!this.real.onRoad(lx, lz, -1) && this.real.free(lx - 0.9, lz) && this.real.free(lx, lz + 0.9) && this.real.free(lx, lz - 0.9)) {
        metroLift(g, lx, lz, acc.ref);
        this.blocks.push({ x0: lx - 0.9, x1: lx + 0.9, z0: lz - 0.9, z1: lz + 0.9 });
      }
    }
  }

  /**
   * 2.21 · Los otros accesos de la estación, donde están en la calle real (vereda, bandejón o plaza), cada uno con su
   * tótem, su letra y la calle a la que da; los que están dentro de un edificio llevan solo el tótem. Se baja por
   * cualquiera (E): todos llegan a la misma mezanina.
   */
  buildRealAccesses(g) {
    this.accesses2 = [];
    const lines = [LINE.id, ...(this.station.combos || [])];
    const night = (this.sky?.night ?? 0) > 0.5 ? 1 : 0;
    for (const a of this.real.d.accesses) {
      const street = accessStreet(a.name, this.station.name, a.ref);
      if (/ascensor/i.test(a.name) && !a.ref) {
        // Acceso que es solo un ascensor (p. ej. «Ascensor Preferencial»): el pabellón del ascensor con su tótem
        metroLift(g, a.x, a.z).rotation.y = a.a;
        metroTotem(g, this.station.name, lines, a.x + 1.6 * Math.cos(a.a), a.z - 1.6 * Math.sin(a.a), { street: "Ascensor" });
        this.blocks.push(rotBlock(a.x, a.z, a.a, 1.1, 1.1));
        continue;
      }
      if (a.inBuilding) {
        const t = metroTotem(g, this.station.name, lines, a.x, a.z, { ref: a.ref, street });
        t.rotation.y = a.a;
        this.blocks.push({ x0: a.x - 0.3, x1: a.x + 0.3, z0: a.z - 0.3, z1: a.z + 0.3 });
        continue;
      }
      const w = 2.8, len = 5.6;
      // ¿Cabe el ascensor al lado? (si no, el acceso va sin él)
      const c = Math.cos(a.a), s = Math.sin(a.a);
      const W = (u, v) => [a.x + u * c + v * s, a.z - u * s + v * c];
      const [ex, ez] = W(-w / 2 - 1.35, len / 2 - 0.9);
      const lift = a.lift && !this.real.onRoad(ex, ez, -1) && this.real.free(ex, ez, 1);
      const acc = metroStreetAccess(g, { name: this.station.name, lines, night, w, len, ref: a.ref, street, lift });
      acc.position.set(a.x, 0.1, a.z);
      acc.rotation.y = a.a;
      this.blocks.push(rotBlock(a.x, a.z, a.a, w / 2 + 0.3, len / 2 + 0.3));
      const [tx, tz] = W(w / 2 + 0.75, len / 2 + 0.7);
      this.blocks.push({ x0: tx - 0.3, x1: tx + 0.3, z0: tz - 0.3, z1: tz + 0.3 });
      if (lift) this.blocks.push({ x0: ex - 0.95, x1: ex + 0.95, z0: ez - 0.95, z1: ez + 0.95 });
      const [mx, mz] = W(0, len / 2 + 0.9);
      this.accesses2.push({ ...a, street, mouth: { x: mx, z: mz } });
    }
  }

  /**
   * 2.21 · Los paraderos de Red alrededor de la estación, donde están y con sus datos reales (código, n.º de parada,
   * recorridos, refugio). Se miran con E; el del juego (donde para el bus) es el de siempre (buildMainStop).
   */
  buildRealStops(g) {
    this.stops2 = [];
    const night = (this.sky?.night ?? 0) > 0.5 ? 1 : 0;
    const play = new Set(busRoutesAt(this.station?.name).map(r => r.id));
    for (const st of this.real.d.stops) {
      const grp = buildRedStop(g, st, { play: st.routes.filter(r => play.has(r)), night });
      grp.position.set(st.x, 0.1, st.z);
      grp.rotation.y = st.a;
      const c = Math.cos(st.a), s = Math.sin(st.a);
      const W = (u, v) => [st.x + u * c + v * s, st.z - u * s + v * c];
      if (st.shelter) { const [cx, cz] = W(1.4, 1.3); this.blocks.push(rotBlock(cx, cz, st.a, 0.85, 2.6)); }
      const [px, pz] = W(0, -2.4);
      this.blocks.push({ x0: px - 0.15, x1: px + 0.15, z0: pz - 0.15, z1: pz + 0.15 });
      const [hx, hz] = W(0.9, 0.8);
      this.stops2.push({ ...st, at: { x: hx, z: hz } });
    }
  }

  /** 2.21 · El paradero del juego en la calle real, con los datos del paradero de OSM (o el de la estación, si no hay). */
  buildMainStop(g, b) {
    const d = this.real.d.busStop || {};
    const ids = busRoutesAt(this.station?.name).map(r => r.id);
    this.busStop = BUS_METRO_STOPS.has(this.station?.name);
    const stop = d.real
      ? { ref: d.ref, n: d.n, name: d.name, routes: [...new Set([...(d.routes ? d.routes.split(";") : []), ...ids])], shelter: true, bench: true }
      : { ref: "", n: 0, name: `(M) ${this.station.name}`, routes: ids, shelter: true, bench: true };
    this.mainStop = stop;
    const px = b.x - 1.2, pz = b.z - 2.2;
    const grp = buildRedStop(g, stop, { play: ids, night: (this.sky?.night ?? 0) > 0.5 ? 1 : 0 });
    grp.position.set(px, 0.1, pz);
    this.blocks.push({ x0: px + 0.6, x1: px + 2.3, z0: pz - 1.2, z1: pz + 3.8 });
    this.blocks.push({ x0: px - 0.15, x1: px + 0.15, z0: pz - 2.55, z1: pz - 2.25 });
  }

  /** Vereda este: locales en planta baja, kiosko y edificios encima. */
  buildEastSide(g, M, rnd, night) {
    const fx = S.walkHalf;
    // Edificio sobre el acceso (oficinas)
    genericBuilding(g, { x: fx + 9, z: 0, w: 18, d: 20, h: 34, style: "glass", night, rnd });
    for (const shop of this.plan.shops) {
      if (shop.stand) { this.buildKiosk(g, M, shop); continue; }
      const h = 12 + Math.floor(rnd() * 6) * 5;
      genericBuilding(g, { x: fx + 9, z: shop.z, w: 18, d: 21.6, h, night, rnd });
      this.buildShopFront(g, M, shop);
    }
    // Extremos de la cuadra
    for (const z of [-84, 84]) genericBuilding(g, { x: fx + 9, z, w: 18, d: 14, h: 20 + rnd() * 20, night, rnd });
  }

  /** Fachada de un local: vidriera iluminada, puerta, toldo de color y letrero con su nombre. */
  buildShopFront(g, M, shop, { fx = S.walkHalf - 0.04, z = shop.z, w = 12 } = {}) {
    const k = w / 12;
    facingPlane(g, 12 * k, 3.2, M.shopGlow, fx, 1.9, z, -1);
    this.buildShopDoor(g, M, shop, fx, z);
    const awn = addBox(g, 1.6, 0.12, 12.4 * k, std(new THREE.Color(shop.color), { rough: 0.8 }), fx - 0.8, 3.75, z);
    awn.rotation.z = -0.25;
    facingPlane(g, 11 * k, 1.25, signMaterial(shop.name.toUpperCase(), { bg: shop.color, font: "800 76px Arial" }), fx - 0.03, 4.6, z, -1);
    if (shop.kind === "banco") {
      facingPlane(g, 1, 1.6, glow(0x2a7fd4), fx - 0.05, 1.5, z + 3.5, -1);    // cajero automático
    }
  }

  /**
   * 2.17 · Puerta de vidrio del local: dos hojas correderas que se abren solas
   * cuando alguien se acerca (por ella se entra caminando). El cajero del banco
   * se usa desde la vereda: su puerta queda cerrada.
   */
  buildShopDoor(g, M, shop, fx, z) {
    M.doorway ||= glow(0xffffff, { map: doorwayTexture((this.sky?.night ?? 0) > 0.5) });
    M.doorGlass ||= std(0xa9c7d8, { metal: 0.5, rough: 0.05, transparent: true, opacity: 0.35, depthWrite: false });
    facingPlane(g, 2, 2.6, ENTERABLE.has(shop.kind) ? M.doorway : M.darkGlass, fx - 0.02, 1.4, z, -1);
    for (const s of [-1, 1]) addBox(g, 0.1, 2.75, 0.1, M.metal, fx - 0.07, 1.375, z + s * 1.05);
    addBox(g, 0.1, 0.14, 2.2, M.metal, fx - 0.07, 2.72, z);
    const leaves = [-1, 1].map(s => {
      const leaf = addBox(g, 0.03, 2.55, 1.0, M.doorGlass, fx - 0.13, 1.33, z + s * 0.5);
      addBox(leaf, 0.04, 2.55, 0.05, M.metal, 0, 0, -s * 0.48);          // canto de la hoja (donde se juntan)
      addBox(leaf, 0.04, 0.08, 1.0, M.metal, 0, -1.24, 0);              // zócalo
      return leaf;
    });
    if (ENTERABLE.has(shop.kind)) this.doors.push({ shop, leaves, z, open: 0 });
  }

  buildKiosk(g, M, shop) {
    const k = new THREE.Group();
    addBox(k, 2, 2.3, 2.4, std(0x2f6b3a, { rough: 0.7 }), 0, 1.15, 0);
    addBox(k, 2.8, 0.12, 3.2, std(new THREE.Color(shop.color)), -0.2, 2.45, 0);
    facingPlane(k, 2, 1, M.shopGlow, -1.02, 1.4, 0, -1);
    facingPlane(k, 2.6, 0.5, signMaterial(shop.name.toUpperCase(), { bg: shop.color, font: "800 70px Arial" }), -1.62, 2.8, 0, -1);
    k.position.set(shop.x, 0, shop.z);
    g.add(k);
    this.blocks.push({ x0: shop.x - 1.15, x1: shop.x + 1.15, z0: shop.z - 1.35, z1: shop.z + 1.35 });
  }

  /** Lado oeste: el hito (si la estación tiene) y edificios genéricos alrededor. */
  buildWestSide(g, M, rnd, night) {
    const fx = -S.walkHalf;
    let halfZ = 0;
    const lm = this.plan.landmark;
    if (lm) {
      const built = buildLandmark(lm, M, { night });
      built.group.position.x = fx;
      g.add(built.group);
      halfZ = built.halfZ;
      this.landmark = { ...lm, halfZ, plaza: built.plaza };
      // Explanada transitable y sus obstáculos (pasados a coordenadas locales)
      this.walkRects.push({ x0: fx - built.plaza + 0.4, x1: fx + 0.5, z0: -halfZ + 0.4, z1: halfZ - 0.4 });
      built.blocks.forEach(b => this.blocks.push({ x0: b.x0 + fx, x1: b.x1 + fx, z0: b.z0, z1: b.z1 }));
    } else this.landmark = null;
    // Edificios genéricos donde no está el hito
    for (let z = -S.halfLen; z < S.halfLen; ) {
      const w = 14 + Math.floor(rnd() * 3) * 4;
      const cz = z + w / 2;
      if (!lm || Math.abs(cz) - w / 2 >= halfZ) genericBuilding(g, { x: fx - 10, z: cz, w: 20, d: w - 0.6, h: 14 + rnd() * 34, night, rnd });
      z += w;
    }
  }

  /** Faroles, árboles, bancos y paradero. */
  buildFurniture(g, M, rnd) {
    const night = (this.sky?.night ?? 0) > 0.5;
    for (let z = -84; z <= 84; z += 24) {
      streetLamp(g, M, S.roadHalf + 0.6, z + 6, -1);
      streetLamp(g, M, -S.roadHalf - 0.6, z - 6, 1);
      if (night) { lampPool(g, S.roadHalf - 1.4, z + 6); lampPool(g, -S.roadHalf + 1.4, z - 6); }
      this.blocks.push({ x0: S.roadHalf + 0.45, x1: S.roadHalf + 0.75, z0: z + 5.85, z1: z + 6.15 });
      this.blocks.push({ x0: -S.roadHalf - 0.75, x1: -S.roadHalf - 0.45, z0: z - 6.15, z1: z - 5.85 });
    }
    // Árboles de la vereda este (en tazas, junto a la solera)
    for (let z = -78; z <= 78; z += 24) {
      if (Math.abs(z) < 8) continue;
      tree(g, M, S.roadHalf + 1.3, z, 0.9);
      this.blocks.push({ x0: S.roadHalf + 0.8, x1: S.roadHalf + 1.8, z0: z - 0.5, z1: z + 0.5 });
    }
    if (!this.landmark) {
      for (let z = -78; z <= 78; z += 24) { tree(g, M, -S.roadHalf - 1.3, z + 12, 0.9); this.blocks.push({ x0: -S.roadHalf - 1.8, x1: -S.roadHalf - 0.8, z0: z + 11.5, z1: z + 12.5 }); }
    }
    this.buildBusStop(g, M, S.roadHalf, 34);
  }

  /** Paradero de micro junto a la solera cx (x local), en z = pz. */
  buildBusStop(g, M, cx, pz) {
    const S = { roadHalf: cx };
    addBox(g, 1.6, 0.08, 5, std(0x2b6cb0, { transparent: true, opacity: 0.75 }), S.roadHalf + 1.4, 2.6, pz);
    addBox(g, 0.08, 2.6, 5, std(0x9fc6e0, { transparent: true, opacity: 0.35 }), S.roadHalf + 2.2, 1.3, pz);
    bench(g, M, S.roadHalf + 1.7, pz, Math.PI / 2);
    this.blocks.push({ x0: S.roadHalf + 1.2, x1: S.roadHalf + 2.3, z0: pz - 2.5, z1: pz + 2.5 });
    // 1.15 · Si pasa el recorrido del juego: letrero con su número (se toma con E)
    this.busStop = BUS_METRO_STOPS.has(this.station?.name);
    if (this.busStop) {
      addBox(g, 0.08, 2.9, 0.08, std(0x5d656c, { metal: 0.5, rough: 0.4 }), S.roadHalf + 0.5, 1.45, pz - 3.2);
      const c = makeCanvas(256, 320), q = c.getContext("2d");
      q.fillStyle = "#0f3d7a"; q.fillRect(0, 0, 256, 320);
      q.fillStyle = "#fff"; q.textAlign = "center"; q.textBaseline = "middle";
      q.font = "800 54px Arial"; q.fillText("PARADA", 128, 52);
      // 1.18 · Los recorridos que paran aquí (hasta 4 números, como en los paraderos de Red)
      const ids = busRoutesAt(this.station.name).map(r => r.id).slice(0, 4);
      const cols = ids.length > 2 ? 2 : ids.length, rows = Math.ceil(ids.length / cols);
      const bw = 200 / cols, bh = rows > 1 ? 70 : 96;
      ids.forEach((id, k) => {
        const x = 28 + (k % cols) * bw, y = 92 + Math.floor(k / cols) * (bh + 8);
        q.fillStyle = "#d7262e"; q.fillRect(x + 3, y, bw - 6, bh);
        q.fillStyle = "#fff"; q.font = `900 ${cols > 1 ? 50 : 76}px Arial`; q.fillText(id, x + bw / 2, y + bh / 2 + 3);
      });
      q.font = "600 24px Arial"; q.fillText(ids.length > 1 ? `${ids.length} recorridos · E` : "Bus Red · E", 128, 282);
      const tex = toTexture(c);
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.94), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.6 }));
      plate.position.set(S.roadHalf + 0.5, 2.5, pz - 3.2);
      plate.rotation.y = Math.PI / 2;
      g.add(plate);
    }
  }

  /* ---------------------------------------------------------------------
     2.6 · Calle real
     --------------------------------------------------------------------- */

  /** Locales del plan en fachadas reales (o puestos en la vereda, si no hay fachada cerca). */
  buildRealShops(g, M) {
    for (const shop of this.plan.shops) {
      if (shop.stand) { this.buildKiosk(g, M, shop); continue; }
      const grp = new THREE.Group();
      grp.position.set(shop.x, 0, shop.z);
      grp.rotation.y = shop.face + Math.PI / 2;     // el −X del grupo mira a la calle (como la vereda este del juego)
      g.add(grp);
      this.buildShopFront(grp, M, shop, { fx: -0.05, z: 0, w: Math.max(5, shop.w || 11) });
    }
  }

  /** El hito es un edificio real: se marca con su placa y la foto se saca desde la vereda de enfrente. */
  buildRealLandmark(g, M) {
    const lm = this.plan.landmark, d = this.real.d.landmark;
    if (!lm || !d) { this.landmark = null; return; }
    this.landmark = { ...lm, halfZ: 10, plaza: 0, spot: { x: d.spot[0], z: d.spot[1] } };
    if (!d.wall) return;                            // plaza, parque o al frente: sin placa
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 0.9), signMaterial(lm.sign || lm.name.toUpperCase(), { bg: "#2b2620", fg: "#e9dcc0", font: "700 72px Georgia" }));
    plate.position.set(d.wall[0] + Math.sin(d.a) * 0.08, 6.2, d.wall[1] + Math.cos(d.a) * 0.08);
    plate.rotation.y = d.a;
    g.add(plate);
  }

  buildRealVehicles(g, rnd) {
    this.vehicles = [];
    this.paths = this.real.lanePaths();
    // Primero las calles más cercanas al acceso (la avenida); las lejanas llevan menos autos
    const near = (path) => Math.min(...path.pts.map(([x, z]) => Math.hypot(x - S.access.x, z - S.access.z)));
    const order = this.paths.map(path => ({ path, d: near(path) - (path.kind === "primary" ? 40 : 0) })).sort((a, b) => a.d - b.d);
    let budget = 46;
    for (const { path, d } of order) {
      const n = Math.min(d < 60 ? 6 : 2, Math.floor(path.len / 40));
      for (let k = 0; k < n && budget > 0; k++, budget--) {
        const bus = path.bus ? rnd() < 0.55 : path.kind === "primary" && rnd() < 0.08;
        const { mesh, len } = this.vehicleMesh(bus, rnd, 1);
        g.add(mesh);
        const vmax = bus ? 9.5 : path.kind === "primary" ? 11 + rnd() * 3 : 7 + rnd() * 2;
        this.vehicles.push({ mesh, path, s: ((k + rnd() * 0.6) * path.len) / n, v: vmax, vmax, len });
      }
    }
    this.sigT = 0;
  }

  /** Autos y buses por las calles reales: frenan ante el de adelante, el jugador y la luz roja. */
  updateRealVehicles(dt, lx, lz) {
    this.sigT += dt;
    this.real.updateSignals(this.sigT);
    for (const c of this.vehicles) {
      const p = sampleLane(c.path, c.s);
      let gap = Infinity;
      for (const o of this.vehicles) {
        if (o === c || o.path !== c.path) continue;
        const d = o.s - c.s - (o.len + c.len) / 2;
        if (d > 0 && d < gap) gap = d;
      }
      for (const sg of c.path.sig) {
        const ds = sg.s - c.s - c.len / 2;
        if (ds < -0.5 || ds > 45) continue;
        const st = this.real.signalState(sg.axis, this.sigT);
        if (st === "r" || (st === "y" && ds > 8)) gap = Math.min(gap, ds - 1.5);
      }
      const rx = lx - p.x, rz = lz - p.z, along = rx * p.dx + rz * p.dz, lat = Math.abs(rx * p.dz - rz * p.dx);
      if (lat < 1.6 && along > 0 && along < 30) gap = Math.min(gap, along - c.len / 2);
      const target = gap < 2.5 ? 0 : gap < 16 ? c.vmax * (gap - 2.5) / 13.5 : c.vmax;
      c.v += THREE.MathUtils.clamp(target - c.v, -6 * dt, 2.5 * dt);
      c.v = Math.max(0, c.v);
      c.s += c.v * dt;
      if (c.s > c.path.len) c.s -= c.path.len;
      const q = sampleLane(c.path, c.s);
      const after = (lx - q.x) * q.dx + (lz - q.z) * q.dz;
      if (this.sound && lat < 18 && Math.sign(along) !== Math.sign(after) && c.v > 2) this.sound("pass", { bus: c.len > 6, speed: c.v, lateral: lat });
      c.mesh.position.set(q.x, 0.1, q.z);
      c.mesh.rotation.y = q.yaw;
    }
  }

  /** La avenida sigue más allá de la cuadra (decorado, no transitable). */
  buildBackdrop(g, M, rnd, night) {
    for (const s of [-1, 1]) {
      for (let z = 100; z < 320; z += 22) {
        genericBuilding(g, { x: s * (S.walkHalf + 10), z, w: 20, d: 20, h: 12 + rnd() * 40, night, rnd });
        genericBuilding(g, { x: s * (S.walkHalf + 10), z: -z, w: 20, d: 20, h: 12 + rnd() * 40, night, rnd });
      }
    }
  }

  /* ---------------------------------------------------------------------
     Autos, micros y peatones
     --------------------------------------------------------------------- */

  buildVehicles(g, rnd) {
    this.vehicles = [];
    for (let i = 0; i < 12; i++) {
      const lane = LANES[i % 4];
      const bus = i % 5 === 2;
      const { mesh: v, len: L } = this.vehicleMesh(bus, rnd, lane.dir);
      const z = -300 + (i * 600) / 12 + rnd() * 20;
      v.position.set(lane.x, 0, z);
      g.add(v);
      const vmax = bus ? 9 : 11 + rnd() * 4;
      this.vehicles.push({ mesh: v, lane, z, v: vmax, vmax, len: L });
    }
  }

  /** Auto o micro (Red: blanca con franja roja); el frente mira a +Z·dir.
   *  2.21 · Con forma de verdad (render/vehicles.js): sedanes, hatchbacks, SUV, camionetas y furgones; el bus con
   *  techo redondeado, pasos de rueda, ventanas y puertas. */
  vehicleMesh(bus, rnd, dir = 1) {
    const v = new THREE.Group();
    let model, L;
    if (bus) {
      model = streetBusGroup({ paint: this._busWhite ??= std(0xeef0f2, { metal: 0.15, rough: 0.4 }), stripe: this._busRed ??= std(0xc8102e, { rough: 0.5 }),
        sign: this._busSign ??= glow(0xffb000), head: this._lens ??= glow(0xfff6d8), tail: this._tail ??= glow(0xc01010) });
      L = 12;
    } else {
      let seed = Math.floor(rnd() * 4294967296) >>> 0;            // un solo número del azar de la ciudad (no corre la secuencia)
      const r2 = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
      const kind = pickCarKind(r2, r2() < 0.06);
      const color = CAR_COLORS[Math.floor(r2() * CAR_COLORS.length)];
      const paint = (this._paints ??= new Map()).get(color) ?? std(color, { metal: 0.45, rough: 0.3 });
      this._paints.set(color, paint);
      model = carGroup(kind, { paint, head: this._lens ??= glow(0xfff6d8), tail: this._tail ??= glow(0xc01010) });
      L = model.userData.model.L;
    }
    model.rotation.y = dir > 0 ? Math.PI : 0;              // los modelos miran a −z
    v.add(model);
    return { mesh: v, len: L };
  }

  /**
   * Peatones con piernas y brazos articulados. Cada uno elige destinos en
   * su vereda (puntos al azar, puertas de locales, el acceso al Metro),
   * camina hacia ellos esquivando faroles, árboles, kiosko, a los demás
   * peatones y al jugador, se detiene un rato y elige otro destino.
   */
  buildPedestrians(g, rnd) {
    this.walkers = [];
    const shirts = [0x2d5f9a, 0x9a2d2d, 0x3b3b3b, 0xe0d6c3, 0x4a7a3a, 0x7a4a8a, 0xc98b2c, 0x1f2a36, 0xb8b8b8];
    const pants = [0x262a33, 0x30435e, 0x3d3229, 0x1b1b1d, 0x55585e];
    const skin = [0xe6c3a0, 0xc99a72, 0x8d5b3a, 0xf1d6bd];
    const hair = [0x1a1410, 0x3b2a1e, 0x6b4a2b, 0x9a9a9a, 0x2a2018];
    const torsoGeo = new THREE.CylinderGeometry(0.2, 0.17, 0.62, 8);
    const legGeo = new THREE.CylinderGeometry(0.075, 0.06, 0.82, 6);
    legGeo.translate(0, -0.41, 0);                           // pivote en la cadera
    const armGeo = new THREE.CylinderGeometry(0.05, 0.045, 0.6, 6);
    armGeo.translate(0, -0.3, 0);                            // pivote en el hombro
    const headGeo = new THREE.SphereGeometry(0.12, 10, 8);
    const hairGeo = new THREE.SphereGeometry(0.125, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const shoeGeo = new THREE.BoxGeometry(0.11, 0.07, 0.22);
    shoeGeo.translate(0, -0.84, 0.04);
    const shoeMat = std(0x141414);
    const rand = (a) => a[Math.floor(rnd() * a.length)];

    for (let i = 0; i < (this.real ? 26 : 18); i++) {
      const p = new THREE.Group();
      const s = 0.9 + rnd() * 0.2;                           // estatura
      const body = new THREE.Group();
      body.scale.setScalar(s);
      p.add(body);
      const pantMat = std(rand(pants), { rough: 0.9 }), shirtMat = std(rand(shirts), { rough: 0.9 }), skinMat = std(rand(skin));
      const legs = [-0.1, 0.1].map(x => {
        const leg = addMesh(body, legGeo, pantMat, x, 0.9, 0);
        addMesh(leg, shoeGeo, shoeMat, 0, 0, 0);
        return leg;
      });
      addMesh(body, torsoGeo, shirtMat, 0, 1.22, 0);
      const arms = [-0.25, 0.25].map(x => addMesh(body, armGeo, shirtMat, x, 1.5, 0));
      addMesh(body, headGeo, skinMat, 0, 1.68, 0);
      addMesh(body, hairGeo, std(rand(hair)), 0, 1.7, -0.015);
      const side = i % 2 ? 1 : -1;
      const ped = { mesh: p, legs, arms, side, x: 0, z: 0, yaw: 0, vx: 0, vz: 0, speed: 1.05 + rnd() * 0.45, phase: rnd() * 6, wait: rnd() * 3, target: null, stuck: 0 };
      const start = this.randomSidewalkPoint(side, rnd);
      ped.x = start.x; ped.z = start.z;
      ped.yaw = rnd() * Math.PI * 2;
      p.position.set(ped.x, 0.1, ped.z);
      g.add(p);
      this.walkers.push(ped);
    }
    this.pedRnd = rnd;
  }

  /** ¿Puede pisar un peatón el punto local (lx, lz)? (veredas y explanada, sin obstáculos) */
  pedFree(lx, lz, margin = 0.35) {
    if (this.real) {                                        // 2.6 · calle real: veredas y plazas, sin calzadas ni edificios
      if (Math.hypot(lx - S.access.x, lz - S.access.z) > 75 || this.real.onRoad(lx, lz, -0.3) || !this.real.free(lx, lz, margin)) return false;
      return !this.blocks.some(b => hitBlock(b, lx, lz, margin));
    }
    if (Math.abs(lx) < S.roadHalf + 0.3) return false;      // no se baja a la calzada
    if (!this.walkRects.some(r => lx >= r.x0 && lx <= r.x1 && lz >= r.z0 && lz <= r.z1)) return false;
    return !this.blocks.some(b => hitBlock(b, lx, lz, margin));
  }

  randomSidewalkPoint(side, rnd = Math.random) {
    if (this.real) {
      for (let k = 0; k < 40; k++) {
        const x = S.access.x + (rnd() - 0.5) * 120, z = S.access.z + (rnd() - 0.5) * 120;
        if (this.pedFree(x, z, 0.5)) return { x, z };
      }
      return { x: S.spawn.x, z: S.spawn.z + 4 };
    }
    for (let k = 0; k < 30; k++) {
      const x = side * (S.roadHalf + 0.9 + rnd() * (S.walkHalf - S.roadHalf - 1.6));
      const z = (rnd() - 0.5) * 2 * (S.halfLen - 3);
      if (this.pedFree(x, z, 0.5)) return { x, z };
    }
    return { x: side * 10, z: 0 };
  }

  /** Próximo destino: un punto de la vereda, la puerta de un local o el acceso al Metro. */
  pickPedTarget(p) {
    const r = this.pedRnd();
    if ((this.real || p.side > 0) && r < 0.35) {
      const shop = this.plan.shops[Math.floor(this.pedRnd() * this.plan.shops.length)];
      return { x: shop.door.x - 0.2, z: shop.door.z + (this.pedRnd() - 0.5), wait: 2 + this.pedRnd() * 5 };
    }
    if ((this.real || p.side > 0) && r < 0.45) return { x: S.access.x, z: S.access.z + S.access.mouthZ + 1.2, wait: 1 + this.pedRnd() * 2 };
    const pt = this.randomSidewalkPoint(p.side, this.pedRnd);
    return { ...pt, wait: this.pedRnd() < 0.4 ? 1 + this.pedRnd() * 4 : 0 };
  }

  updatePedestrians(dt, plx, plz) {
    const list = this.walkers;
    for (const p of list) {
      if (!p.target) p.target = this.pickPedTarget(p);
      let dx = p.target.x - p.x, dz = p.target.z - p.z;
      const dist = Math.hypot(dx, dz);
      let moving = false;

      if (dist < 0.4 || p.stuck > 4) {
        // Llegó (o no puede llegar): espera un poco y elige otro destino
        p.wait -= dt;
        if (p.wait <= 0 || p.stuck > 4) { p.target = this.pickPedTarget(p); p.wait = p.target.wait; p.stuck = 0; }
      } else {
        // Dirección deseada + separación de los demás y del jugador
        let fx = dx / dist, fz = dz / dist;
        const push = (ox, oz, radius, k) => {
          const ax = p.x - ox, az = p.z - oz, d = Math.hypot(ax, az);
          if (d > 0.001 && d < radius) { const f = k * (1 - d / radius) / d; fx += ax * f; fz += az * f; }
        };
        for (const o of list) if (o !== p) push(o.x, o.z, 1.1, 1.6);
        push(plx, plz, 1.5, 3);
        const fl = Math.hypot(fx, fz) || 1;
        fx /= fl; fz /= fl;
        // Si el camino recto choca con algo, prueba girando a uno y otro lado
        const step = p.speed * dt;
        let moved = false;
        for (const a of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
          const c = Math.cos(a), s = Math.sin(a);
          const mx = fx * c - fz * s, mz = fx * s + fz * c;
          const nx = p.x + mx * step, nz = p.z + mz * step;
          if (this.pedFree(nx, nz) && Math.hypot(nx - plx, nz - plz) > 0.55) {
            p.vx += (mx * p.speed - p.vx) * Math.min(1, dt * 6);
            p.vz += (mz * p.speed - p.vz) * Math.min(1, dt * 6);
            moved = true;
            break;
          }
        }
        if (!moved) { p.vx *= 0.8; p.vz *= 0.8; p.stuck += dt; }
        else p.stuck = Math.max(0, p.stuck - dt);
        const nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
        if (this.pedFree(nx, nz, 0.2)) { p.x = nx; p.z = nz; }
        moving = Math.hypot(p.vx, p.vz) > 0.2;
      }
      if (!moving) { p.vx *= 0.85; p.vz *= 0.85; }

      // Orientación suave hacia donde camina (o hacia el destino si está quieto)
      const sp = Math.hypot(p.vx, p.vz);
      if (sp > 0.15) {
        const want = Math.atan2(p.vx, p.vz);
        let d = want - p.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        p.yaw += d * Math.min(1, dt * 7);
      }

      // Paso: piernas y brazos opuestos, balanceo del cuerpo
      const gait = Math.min(1, sp / 1.1);
      p.phase += dt * (5.5 + sp * 2.5) * (gait > 0.05 ? 1 : 0);
      const swing = Math.sin(p.phase) * 0.55 * gait;
      p.legs[0].rotation.x = swing;
      p.legs[1].rotation.x = -swing;
      p.arms[0].rotation.x = -swing * 0.8;
      p.arms[1].rotation.x = swing * 0.8;
      p.mesh.position.set(p.x, 0.1 + Math.abs(Math.cos(p.phase)) * 0.035 * gait, p.z);
      p.mesh.rotation.y = p.yaw;
    }
  }

  /* ---------------------------------------------------------------------
     Cada fotograma
     --------------------------------------------------------------------- */

  /** @param {THREE.Vector3} playerPos  posición del jugador (mundo) o null */
  update(dt, playerPos, clock) {
    if (!this.group || !this.group.visible) return;
    this.timeT -= dt;
    if (this.timeT <= 0) { this.timeT = 20; this.setTime(clock); }
    const lx = playerPos ? playerPos.x - this.origin.x : 1e9, lz = playerPos ? playerPos.z - this.origin.z : 1e9;
    // 2.4 · El área con sombras acompaña al pasajero (o queda sobre la salida del Metro mientras sube)
    if (this.shadow) {
      const f = this._sf ??= new THREE.Vector3();
      f.set(playerPos ? playerPos.x : this.origin.x + S.access.x, this.origin.y, playerPos ? playerPos.z : this.origin.z + S.access.z);
      this.shadow.follow(f, this.sunDir);
    }

    // Vehículos: frenan ante el jugador y ante el de adelante
    if (this.real) this.updateRealVehicles(dt, lx, lz);
    else for (const c of this.vehicles) {
      const dir = c.lane.dir;
      let gap = Infinity;
      if (Math.abs(lx - c.lane.x) < 1.7) {
        const d = (lz - c.z) * dir - c.len / 2;
        if (d > -1 && d < gap) gap = d;
      }
      for (const o of this.vehicles) {
        if (o === c || o.lane !== c.lane) continue;
        const d = (o.z - c.z) * dir - (o.len + c.len) / 2;
        if (d > 0 && d < gap) gap = d;
      }
      const target = gap < 3 ? 0 : gap < 14 ? c.vmax * (gap - 3) / 11 : c.vmax;
      c.v += THREE.MathUtils.clamp(target - c.v, -6 * dt, 2.5 * dt);
      const relBefore = c.z - lz;
      c.z += c.v * dir * dt;
      // Pasa junto al jugador: zumbido del auto (o motor de la micro)
      const lateral = Math.abs(c.lane.x - lx);
      if (this.sound && lateral < 18 && Math.sign(relBefore) !== Math.sign(c.z - lz) && c.v > 2) {
        this.sound("pass", { bus: c.len > 6, speed: c.v, lateral });
      }
      if (c.z * dir > 320) c.z -= 640 * dir;
      c.mesh.position.z = c.z;
      c.mesh.rotation.y = dir > 0 ? 0 : Math.PI;
    }

    // 2.17 · Puertas automáticas: se abren con el jugador o un peatón cerca
    for (const d of this.doors) {
      const dx = d.shop.door.x, dz = d.shop.door.z;
      const me = Math.hypot(lx - dx, lz - dz) < 2.6;
      const want = me || d.hold || this.walkers?.some(p => Math.hypot(p.x - dx, p.z - dz) < 1.6);
      if (me && want && d.open < 0.02 && !this.inside) this.sound?.("door", {});
      d.open = THREE.MathUtils.clamp(d.open + (want ? 1.6 : -1.1) * dt, 0, 1);
      const e = d.open * d.open * (3 - 2 * d.open);
      d.leaves.forEach((leaf, i) => { leaf.position.z = d.z + (i ? 1 : -1) * (0.5 + 0.98 * e); });
    }
    if (this.inside) this.inside.update(dt, lx - INSIDE.x, lz - INSIDE.z);

    // Ambiente: bocinas, pájaros (de día) y alguna sirena a lo lejos (adentro de un local no se oyen)
    if (this.sound && !this.inside) {
      this.hornT -= dt; this.birdT -= dt; this.sirenT -= dt;
      if (this.hornT <= 0) { this.hornT = 12 + Math.random() * 30; this.sound("horn", { far: Math.random() < 0.6 }); }
      if (this.birdT <= 0) { this.birdT = 3 + Math.random() * 7; if (this.sky.day > 0.4) this.sound("birds", {}); }
      if (this.sirenT <= 0) { this.sirenT = 90 + Math.random() * 150; this.sound("siren", {}); }
    }

    // Peatones: caminan a sus destinos esquivando obstáculos, a los demás y al jugador
    this.updatePedestrians(dt, lx, lz);
  }

  /* ---------------------------------------------------------------------
     Consultas del jugador (coordenadas del mundo)
     --------------------------------------------------------------------- */

  local(wx, wz) { return { lx: wx - this.origin.x, lz: wz - this.origin.z }; }

  /** ¿Se puede pisar (wx, wz)? */
  walkable(wx, wz) {
    if (!this.group) return false;
    const { lx, lz } = this.local(wx, wz);
    if (this.inside) return this.inside.walkable(lx - INSIDE.x, lz - INSIDE.z);
    if (!this.walkRects.some(r => lx >= r.x0 && lx <= r.x1 && lz >= r.z0 && lz <= r.z1)) return false;
    if (this.walkers?.some(p => Math.hypot(p.x - lx, p.z - lz) < 0.45)) return false;   // no se atraviesa a los peatones
    if (this.real && !this.real.free(lx, lz)) return false;                              // 2.6 · edificios, árboles y postes reales
    return !this.blocks.some(b => hitBlock(b, lx, lz, 0.25));
  }

  /** Altura del suelo (vereda o calzada), en coordenadas del mundo. */
  floorAt(wx) {
    if (this.inside) return this.origin.y + this.inside.floor;
    const { lx } = this.local(wx, this.origin.z);
    if (this.real) return this.origin.y + 0.1;              // 2.6 · la calle real se dibuja pareja (soleras pintadas)
    return this.origin.y + (Math.abs(lx) > S.roadHalf ? 0.1 : 0);
  }

  /** Punto donde aparece el jugador al empezar la partida (mundo) y hacia dónde mira. */
  spawn() {
    return { x: this.origin.x + S.spawn.x, y: this.origin.y + 0.1, z: this.origin.z + S.spawn.z, yaw: Math.PI / 2 };   // mirando hacia la avenida y el hito
  }

  /** Lo que hay al alcance: acceso al Metro, un local o el hito. */
  nearest(wpos) {
    const { lx, lz } = this.local(wpos.x, wpos.z);
    if (this.inside) {
      const ix = lx - INSIDE.x, iz = lz - INSIDE.z;
      if (this.inside.atCounter(ix, iz)) return { kind: "counter", shop: this.inside.shop };
      if (this.inside.nearDoor(ix, iz)) return { kind: "exit", shop: this.inside.shop };
      return null;
    }
    const a = S.access;
    if (Math.hypot(lx - a.x, lz - (a.z + a.mouthZ + 0.8)) < 2.4) return { kind: "access" };
    if (Math.abs(lx - this.busStopAt.x) < 2.6 && Math.abs(lz - this.busStopAt.z) < 4.5) return { kind: "busstop", served: !!this.busStop };
    // 2.21 · Los otros accesos (se baja por cualquiera) y los paraderos de alrededor (se mira la señal)
    for (const a of this.accesses2 || []) if (Math.hypot(lx - a.mouth.x, lz - a.mouth.z) < 2.2) return { kind: "access2", access: a };
    for (const p of this.stops2 || []) if (Math.hypot(lx - p.at.x, lz - p.at.z) < 2.4) return { kind: "redstop", stop: p };
    let best = null, bd = 2.6;
    for (const shop of this.plan.shops) {
      const d = Math.hypot(lx - shop.door.x, lz - shop.door.z);
      if (d < bd) { bd = d; best = shop; }
    }
    if (best) return { kind: "shop", shop: best };
    if (this.landmark && this.atLandmark(lx, lz)) return { kind: "landmark", landmark: this.landmark };
    return null;
  }

  /** 2.21 · Donde queda el pasajero que baja por otro acceso: en la boca del acceso del juego, mirando escalera abajo. */
  mainMouthSpot() {
    const a = S.access;
    return { x: this.origin.x + a.x, y: this.origin.y + 0.1, z: this.origin.z + a.z + a.mouthZ - 0.5, yaw: 0 };
  }

  /** ¿Entró en la boca de la escalera? Desde ahí se baja caminando (el pasajero pasa a la estación). */
  atAccessMouth(wpos) {
    const { lx, lz } = this.local(wpos.x, wpos.z);
    const a = S.access;
    return Math.abs(lx - a.x) < a.halfX - 0.3 && lz < a.z + a.mouthZ - 0.2 && lz > a.z + a.mouthZ - 1.6;
  }

  /** Dónde se saca la foto del hito (local). */
  landmarkGoal() {
    return this.landmark?.spot || { x: -S.walkHalf - 3, z: 0 };
  }

  /** ¿Está el jugador (local) donde se saca la foto del hito? */
  atLandmark(lx, lz) {
    if (!this.landmark) return false;
    if (this.landmark.spot) return Math.hypot(lx - this.landmark.spot.x, lz - this.landmark.spot.z) < 6;
    return lx < -3 && Math.abs(lz) < this.landmark.halfZ + 6;
  }

  /* ---------------------------------------------------------------------
     2.17 · Entrar y salir de los locales
     --------------------------------------------------------------------- */

  /** ¿Se puede entrar caminando a este local? */
  canEnter(shop) { return !!shop && ENTERABLE.has(shop.kind) && !shop.stand && this.doors.some(d => d.shop === shop); }

  /** Fachada del local (punto en la puerta) y hacia dónde mira (hacia la vereda), en coordenadas locales. */
  doorFrame(shop) {
    const fx = this.real ? shop.x : S.walkHalf, fz = shop.z;
    let ox = shop.door.x - fx, oz = shop.door.z - fz;
    const n = Math.hypot(ox, oz) || 1;
    ox /= n; oz /= n;
    return { fx, fz, ox, oz };
  }

  /** Local cuya puerta (abierta) está cruzando el jugador, caminando hacia adentro. */
  shopDoorAt(wpos, yaw) {
    if (this.inside) return null;
    const { lx, lz } = this.local(wpos.x, wpos.z);
    const fwx = -Math.sin(yaw), fwz = -Math.cos(yaw);
    for (const d of this.doors) {
      if (d.open < 0.55) continue;
      const { fx, fz, ox, oz } = this.doorFrame(d.shop);
      const rx = lx - fx, rz = lz - fz;
      const depth = rx * ox + rz * oz, lat = Math.abs(-rx * oz + rz * ox);
      if (depth < 0.95 && depth > -0.6 && lat < 0.8 && fwx * ox + fwz * oz < -0.35) return d.shop;
    }
    return null;
  }

  /** Abre (o deja de forzar) la puerta de un local. */
  holdDoor(shop, on = true) { const d = this.doors.find(x => x.shop === shop); if (d) d.hold = on; }

  /** Entra al local: arma su interior y devuelve dónde queda el jugador (mundo). */
  enterShop(shop) {
    this.inside?.dispose();
    const it = this.inside = new ShopInterior(shop, { night: this.sky?.night ?? 0 });
    this.group.add(it.group);
    markCity(it.group);
    this.applySky();
    const e = it.entry;
    return { x: this.origin.x + INSIDE.x + e.x, y: this.origin.y + it.floor, z: this.origin.z + INSIDE.z + e.z, yaw: e.yaw };
  }

  /** ¿Está saliendo por la puerta del local? */
  leavingShop(wpos, yaw) {
    if (!this.inside) return false;
    const { lx, lz } = this.local(wpos.x, wpos.z);
    return this.inside.leaving(lx - INSIDE.x, lz - INSIDE.z, yaw);
  }

  /** Mesón del local donde está el jugador (mundo), para guiar a la caja. */
  counterSpot() {
    if (!this.inside) return null;
    const c = this.inside.counterSpot;
    return { x: this.origin.x + INSIDE.x + c.x, z: this.origin.z + INSIDE.z + c.z };
  }

  /** Puerta del local, vista desde adentro (mundo). */
  shopExitSpot() {
    if (!this.inside) return null;
    return { x: this.origin.x + INSIDE.x + 0.4, z: this.origin.z + INSIDE.z };
  }

  /** Sale a la vereda frente a la puerta (con la puerta abierta), mirando hacia afuera. */
  exitShop() {
    const shop = this.inside?.shop;
    this.inside?.dispose();
    this.inside = null;
    this.applySky();
    if (!shop) return null;
    const { fx, fz, ox, oz } = this.doorFrame(shop);
    const d = this.doors.find(x => x.shop === shop);
    if (d) d.open = 1;
    return { x: this.origin.x + fx + ox * 1.15, y: this.origin.y + 0.1, z: this.origin.z + fz + oz * 1.15, yaw: Math.atan2(-ox, -oz), shop };
  }

  hint(wpos) {
    const n = this.nearest(wpos);
    if (this.inside) {
      const sh = this.inside.shop;
      if (n?.kind === "counter") return `${keyText("E", "✋ Usar")} · pedir en la caja de ${sh.name}`;
      if (n?.kind === "exit") return `Camina hacia la puerta (o ${keyText("E", "✋ Usar")}) para salir a la calle`;
      return `Dentro de ${sh.name} · la caja está al fondo, en el mesón · ${keyText("J", "🎯")} misiones`;
    }
    if (n?.kind === "access") return `${keyText("E", "✋ Usar")} (o camina hacia la escalera) · bajar a la estación ${this.station.name}`;
    if (n?.kind === "shop") return n.shop.kind === "banco" ? `${keyText("E", "✋ Usar")} · usar el cajero automático (saldo y movimientos)`
      : n.shop.stand ? `${keyText("E", "✋ Usar")} · comprar en ${n.shop.name} (${n.shop.label.toLowerCase()})`
      : `Camina hacia la puerta (o ${keyText("E", "✋ Usar")}) para entrar a ${n.shop.name} (${n.shop.label.toLowerCase()})`;
    if (n?.kind === "landmark") return `${keyText("E", "✋ Usar")} · sacar una foto de ${n.landmark.name}`;
    if (n?.kind === "access2") return `${keyText("E", "✋ Usar")} · bajar a la estación ${this.station.name} por el acceso ${n.access.ref || ""}${n.access.street ? ` (${n.access.street})` : ""}`.replace("acceso  (", "acceso (");
    if (n?.kind === "redstop") return `Paradero ${n.stop.ref}${n.stop.n ? ` · Parada ${n.stop.n}` : ""} · ${n.stop.name}${n.stop.routes.length ? ` · ${n.stop.routes.slice(0, 8).join(", ")}${n.stop.routes.length > 8 ? "…" : ""}` : ""}`;
    if (n?.kind === "busstop") return n.served ? `${keyText("E", "✋ Usar")} · paradero (${busRoutesAt(this.station?.name).map(r => r.id).join(", ")}): tomar el bus` : "Paradero: por aquí no pasa ninguno de los recorridos del juego";
    if (this.real) return `Calle real de ${this.station.name} (${OSM_ATTRIBUTION})${this.landmark ? ` · ${this.landmark.name}` : ""} · ${keyText("J", "🎯")} misiones`;
    return this.landmark
      ? `Calle de ${this.station.name} · enfrente: ${this.landmark.name} · locales en la vereda del Metro · ${keyText("J", "🎯")} misiones`
      : `Calle de ${this.station.name} · locales en la vereda del Metro · ${keyText("J", "🎯")} misiones`;
  }
}

/** 2.17 · Lo que se ve por la puerta de vidrio: el local iluminado, con estanterías y el mesón al fondo. */
function doorwayTexture(night) {
  const c = makeCanvas(128, 192), g = c.getContext("2d");
  const bg = g.createLinearGradient(0, 0, 0, 192);
  bg.addColorStop(0, night ? "#fff1d0" : "#f4efe4"); bg.addColorStop(1, night ? "#b9a888" : "#c9c2b4");
  g.fillStyle = bg; g.fillRect(0, 0, 128, 192);
  const cols = ["#d32f2f", "#1976d2", "#fbc02d", "#388e3c", "#f57c00", "#7b1fa2"];
  for (const x0 of [6, 92]) for (let y = 70; y < 170; y += 22) {
    g.fillStyle = "#8d8a84"; g.fillRect(x0, y + 14, 30, 3);
    for (let x = x0; x < x0 + 30; x += 6) { g.fillStyle = cols[(x + y) % cols.length]; g.fillRect(x, y + 2, 5, 12); }
  }
  g.fillStyle = "#7a5a3a"; g.fillRect(40, 118, 48, 30);           // mesón
  g.fillStyle = "#3b4a5a"; g.fillRect(56, 92, 16, 26);            // quien atiende
  g.fillStyle = "#e6c3a0"; g.beginPath(); g.arc(64, 86, 7, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#ffffff"; for (const x of [24, 64, 104]) g.fillRect(x - 12, 4, 24, 5);   // luminarias
  g.fillStyle = "#9b9488"; g.fillRect(0, 160, 128, 32);           // piso
  return toTexture(c);
}
