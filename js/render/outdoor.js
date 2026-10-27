/* ==========================================================================
   MetroSim — 1.5 · render/outdoor.js
   El Metro AL AIRE LIBRE: viaductos, trincheras, la ciudad a los lados,
   el cielo según la hora y el tiempo (lluvia).

   Los tramos vienen del motor (engine/sections.js). Aquí se dibuja lo que
   hay alrededor de la vía cuando no va en túnel:
     · VIADUCTO: tablero de hormigón con pretiles y pasillo de evacuación,
       pilas con capitel cada 30 m hasta el suelo y, abajo, la avenida
       (Vicuña Mackenna, Pajaritos…) con autos, veredas, árboles y faroles;
     · TRINCHERA: muros de contención hasta el nivel de la calle, con
       puntales de lado a lado, y la avenida a ambos lados arriba;
     · en las líneas con catenaria, pórticos de acero que la sostienen;
     · edificios genéricos a ambos lados (de noche con ventanas encendidas).
   Todo sigue el perfil de la línea con render/trackLift.js: la geometría
   se construye en el mundo "plano" con la calle a una altura relativa al
   carril (groundRel) y la tarjeta gráfica la sube o la baja con la vía.

   Además maneja el CIELO cuando la cámara está afuera (fondo, niebla, sol
   y luz del cielo según la hora y la nubosidad) y la LLUVIA (gotas
   alrededor de la cámara), también en la calle del pasajero.
   ========================================================================== */

import * as THREE from "three";
import { CONFIG, STATIONS, WORLD } from "../config.js";
import { ROUTE_A } from "../engine/route.js";
import { lineStock } from "../engine/fleet.js";
import { WEATHER } from "../engine/weather.js";
import { std, glow, addBox, addBoxSpan, makeCanvas, toTexture, concreteTexture } from "../utils.js";

const S = CONFIG.station;
/** Color del túnel (fondo y niebla bajo tierra). */
const TUNNEL_BG = new THREE.Color(0x040608);
/** Media anchura del corredor de la vía al aire libre (muros de trinchera / suelo bajo el viaducto). */
const CORRIDOR = 9.3;
/** Pistas de la avenida a cada lado y veredas (|x|). */
const ROAD = [CORRIDOR, 22], WALK = [22, 26];
/** Separación de las pilas del viaducto (m). */
const PIER = 30;

/** Luz del día según la hora (s) y la nubosidad: sol (0..1), color del cielo, noche. */
export function skyAt(clock, cloud = WEATHER.cloud, rain = WEATHER.rain) {
  const h = (clock / 3600) % 24;
  const sun = Math.sin(Math.PI * (h - 6.8) / 13.6);              // > 0 entre ~06:50 y ~20:25
  const day = THREE.MathUtils.clamp(sun * 2.2 + 0.15, 0, 1);
  const dusk = THREE.MathUtils.clamp(1 - Math.abs(sun - 0.08) / 0.22, 0, 1) * (h > 12 ? 1 : 0.7) * (1 - cloud * 0.8);
  const color = new THREE.Color(0x0a1224).lerp(new THREE.Color(0x8fc3ee), day).lerp(new THREE.Color(0xf09a5e), dusk * 0.55);
  // Nubes: el cielo se vuelve gris (más oscuro si llueve)
  const grey = new THREE.Color(0x0c0f13).lerp(new THREE.Color(rain > 0 ? 0x7d858d : 0xa9b1b8), day);
  color.lerp(grey, cloud * 0.85);
  return { sun, day, dusk, color, cloud, night: day < 0.25 ? 1 : 0, light: day * (1 - 0.55 * cloud) };
}

/* ==========================================================================
   Geometría auxiliar: cintas que siguen una altura variable a lo largo de z
   ========================================================================== */

/**
 * Cinta horizontal (mirando hacia arriba) entre x0 y x1, de zA a zB (zA > zB),
 * a la altura y(z). La textura va de u = 0 en x0 a u = 1 en x1 y repite cada 10 m.
 */
function flatRibbon(x0, x1, zA, zB, y, step = 10) {
  const n = Math.max(1, Math.ceil((zA - zB) / step));
  const pos = [], uv = [], idx = [];
  const up = x1 < x0;                                  // orden de los vértices para que la cara mire hacia +Y
  for (let i = 0; i <= n; i++) {
    const z = zA - (zA - zB) * i / n, yy = y(z);
    pos.push(x0, yy, z, x1, yy, z);
    uv.push(0, (zA - z) / 10, 1, (zA - z) / 10);
    if (i < n) {
      const a = i * 2;
      if (up) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  return ribbonGeometry(pos, uv, idx);
}

/** Cinta vertical en x desde y0(z) hasta y1(z), mirando hacia normalX (−1 / +1). */
function wallRibbon(x, zA, zB, y0, y1, normalX, step = 10) {
  const n = Math.max(1, Math.ceil((zA - zB) / step));
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const z = zA - (zA - zB) * i / n, a = y0(z), b = y1(z);
    pos.push(x, a, z, x, b, z);
    uv.push((zA - z) / 4, 0, (zA - z) / 4, (b - a) / 4);
    if (i < n) {
      const k = i * 2;
      if (normalX > 0) idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      else idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  return ribbonGeometry(pos, uv, idx);
}

function ribbonGeometry(pos, uv, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/* ---------- Texturas ---------- */

function asphaltCanvas() {
  const c = makeCanvas(128, 256), g = c.getContext("2d");
  g.fillStyle = "#3b3e42"; g.fillRect(0, 0, 128, 256);
  const img = g.getImageData(0, 0, 128, 256);
  for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 18; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  g.putImageData(img, 0, 0);
  // Líneas de pista discontinuas (3 pistas por sentido)
  g.fillStyle = "#d9d6c8";
  [42, 85].forEach(x => g.fillRect(x, 0, 3, 120));
  g.fillRect(4, 0, 3, 256);
  g.fillStyle = "#e3b62c"; g.fillRect(122, 0, 3, 256);
  return c;
}

function facadeCanvases() {
  const W = 128, H = 256, cols = 4, rows = 10;
  const day = makeCanvas(W, H), night = makeCanvas(W, H);
  const d = day.getContext("2d"), n = night.getContext("2d");
  d.fillStyle = "#bdb8b0"; d.fillRect(0, 0, W, H);
  n.fillStyle = "#000"; n.fillRect(0, 0, W, H);
  const cw = W / cols, rh = H / rows;
  for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
    const x = k * cw + cw * 0.15, y = r * rh + rh * 0.2, w = cw * 0.7, h = rh * 0.55;
    d.fillStyle = "#4a5866"; d.fillRect(x, y, w, h);
    if (Math.random() < 0.45) { n.fillStyle = Math.random() < 0.5 ? "#ffd99a" : "#fff0cf"; n.fillRect(x, y, w, h); }
  }
  d.fillStyle = "#00000020";
  for (let r = 0; r < rows; r++) d.fillRect(0, r * rh, W, 2);
  return { day, night };
}

/* ==========================================================================
   OutdoorView
   ========================================================================== */

export class OutdoorView {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;
    const line = ROUTE_A.line;
    this.sec = line.sectionsInfo;
    this.profile = line.profile;
    this.catenary = lineStock(line).supply === "catenaria";
    this.group = new THREE.Group();
    this.group.name = "outdoor";
    scene.add(this.group);
    this.exposure = 0;                 // 0 = bajo tierra … 1 = al aire libre (en la cámara)

    // Tramos al aire libre recortados al mundo de la línea
    this.spans = this.sec.spans
      .filter(s => s.type !== "tunel")
      .map(s => ({ type: s.type, zA: Math.min(s.zA, WORLD.start), zB: Math.max(s.zB, WORLD.end) }))
      .filter(s => s.zA - s.zB > 1);
    if (this.spans.length) this.build();

    // Luz del día: sol y cielo (solo cuentan al aire libre)
    this.sun = new THREE.DirectionalLight(0xfff1dc, 0);
    this.sun.position.set(-60, 120, 40);
    this.hemi = new THREE.HemisphereLight(0xcfe4ff, 0x4a4238, 0);
    scene.add(this.sun, this.sun.target, this.hemi);

    this.buildRain();
  }

  /** Altura de la calle respecto del carril (m) en una z del mundo, según el tipo de tramo. */
  groundRel(z) {
    const rel = this.profile.groundAt(z) - this.profile.elevationAt(z);
    const type = this.sec.typeAt(z);
    if (type === "viaducto") return THREE.MathUtils.clamp(rel, -12, -4);
    if (type === "trinchera") return THREE.MathUtils.clamp(rel, -12, 9);
    return THREE.MathUtils.clamp(rel, 0, 12);
  }

  /** ¿Está z dentro del vestíbulo de una estación? */
  inStation(z) { return STATIONS.some(s => z < s.z + S.hallZ1 && z > s.z + S.hallZ0); }

  /* ---------------------------------------------------------------------
     Construcción
     --------------------------------------------------------------------- */
  build() {
    const g = this.group, rel = (z) => this.groundRel(z);
    const fac = facadeCanvases();
    const M = this.M = {
      concrete: std(0xffffff, { map: toTexture(concreteTexture("#8d8f8c", 26), 1, 1), rough: 0.9 }),
      deck: std(0xffffff, { map: toTexture(concreteTexture("#9a9c98", 20), 1, 1), rough: 0.85 }),
      wall: std(0xffffff, { map: toTexture(concreteTexture("#7f817d", 30), 1, 1), rough: 0.95, side: THREE.DoubleSide }),
      gravel: std(0xffffff, { map: toTexture(concreteTexture("#5b5650", 40), 1, 1), rough: 1 }),
      grass: std(0x55703f, { rough: 1 }),
      earth: std(0x6f6a55, { rough: 1 }),
      asphalt: std(0xffffff, { map: toTexture(asphaltCanvas(), 1, 1), rough: 0.9 }),
      sidewalk: std(0xa8a49b, { rough: 0.85 }),
      steel: std(0x7d868d, { metal: 0.7, rough: 0.4 }),
      railing: std(0x4f585e, { metal: 0.6, rough: 0.5 }),
      building: std(0xffffff, { map: toTexture(fac.day), rough: 0.8, emissive: 0xffffff, emissiveIntensity: 0 }),
      trunk: std(0x5a4632, { rough: 0.9 }),
      leaves: std(0x3f6b34, { rough: 0.9 }),
      lampHead: glow(0xfff1c9),
      carBody: std(0xffffff, { metal: 0.5, rough: 0.35 }),
      carGlass: std(0x1b232b, { metal: 0.3, rough: 0.2 }),
      headlight: glow(0xfff6dc),
      taillight: glow(0xff2a1a),
    };
    M.building.emissiveMap = toTexture(fac.night);               // de noche, solo brillan las ventanas encendidas

    for (const span of this.spans) this.buildSpan(g, M, span, rel);
    this.buildBuildings(g, M);
    this.buildCars(g, M);
  }

  buildSpan(g, M, span, rel) {
    const { zA, zB } = span;
    const CH = 60;                                     // trozos de 60 m: viaducto o trinchera según la cota
    for (let a = zA; a > zB + 0.5; a -= CH) {
      const b = Math.max(zB, a - CH), mid = (a + b) / 2;
      const station = this.inStation(mid);
      const viaduct = rel(mid) < -1.5;
      if (viaduct) this.buildViaductPiece(g, M, a, b, rel, station);
      else this.buildTrenchPiece(g, M, a, b, rel, station);
      // Suelo: a los lados de la vía siempre; bajo el viaducto también en el centro (bandejón)
      [-1, 1].forEach(s => {
        g.add(new THREE.Mesh(flatRibbon(s * 220, s * WALK[1], a, b, z => rel(z) - 0.02), M.earth));
        g.add(new THREE.Mesh(flatRibbon(s * WALK[1], s * WALK[0], a, b, z => rel(z) + 0.12), M.sidewalk));
        // De afuera hacia la vía: la línea amarilla del bandejón queda junto a la vía
        g.add(new THREE.Mesh(flatRibbon(s * ROAD[1], s * ROAD[0], a, b, z => rel(z) + 0.01), M.asphalt));
      });
      if (viaduct) g.add(new THREE.Mesh(flatRibbon(-CORRIDOR, CORRIDOR, a, b, z => rel(z) + 0.0), M.grass));
    }
    // Faroles y árboles en las veredas, cada 30 m (instanciados)
    this.buildStreetFurniture(g, M, zA, zB, rel);
    // Catenaria al aire libre: pórticos de acero cada 40 m
    if (this.catenary) this.buildCatenaryMasts(g, M, zA, zB);
  }

  buildViaductPiece(g, M, a, b, rel, station) {
    const w = station ? S.wallX + 0.6 : 5.2;
    // Tablero (bajo la losa de vía) y pretiles con pasillo de evacuación
    addBoxSpan(g, 0, w * 2, -1.9, -0.06, a, b, M.deck);
    if (!station) {
      [-1, 1].forEach(s => {
        addBoxSpan(g, s * 4.4, 1.5, -0.06, 0.45, a, b, M.concrete);                 // pasillo de evacuación
        addBoxSpan(g, s * 5.05, 0.2, -0.06, 1.25, a, b, M.concrete);                // pretil
        addBoxSpan(g, s * 5.05, 0.06, 1.25, 1.35, a, b, M.railing);
      });
      addBoxSpan(g, 0, 7.4, -0.06, -0.02, a, b, M.gravel);
    }
    // Pilas: una central con capitel (o dos filas bajo las estaciones)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const first = Math.ceil(b / PIER) * PIER;
    const zs = [];
    for (let z = first; z < a; z += station ? PIER / 2 : PIER) zs.push(z);
    if (!zs.length) return;
    const xs = station ? [-6, 6] : [0];
    const piers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), M.concrete, zs.length * xs.length);
    const caps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), M.concrete, zs.length);
    let k = 0;
    zs.forEach((z, i) => {
      const top = -1.9, bottom = rel(z) - 0.2, h = Math.max(0.5, top - bottom);
      xs.forEach(x => { v.set(x, bottom + h / 2, z); sc.set(station ? 1.4 : 2.0, h, station ? 1.4 : 1.7); piers.setMatrixAt(k++, m.compose(v, q, sc)); });
      v.set(0, top - 0.5, z); sc.set(station ? w * 2 : 7.5, 1.0, 2.2); caps.setMatrixAt(i, m.compose(v, q, sc));
    });
    piers.computeBoundingSphere(); caps.computeBoundingSphere();
    g.add(piers, caps);
  }

  buildTrenchPiece(g, M, a, b, rel, station) {
    const top = (z) => Math.max(rel(z), 1.2);
    // Muros de contención hasta la calle (o un pretil si la vía va casi a nivel)
    g.add(new THREE.Mesh(wallRibbon(-CORRIDOR, a, b, () => -0.1, top, 1), M.wall));
    g.add(new THREE.Mesh(wallRibbon(CORRIDOR, a, b, () => -0.1, top, -1), M.wall));
    // Coronación de los muros y fondo de la trinchera
    [-1, 1].forEach(s => g.add(new THREE.Mesh(flatRibbon(s * CORRIDOR - 0.4, s * CORRIDOR + 0.4, a, b, z => top(z) + 0.05), M.concrete)));
    if (!station) {
      g.add(new THREE.Mesh(flatRibbon(-CORRIDOR, CORRIDOR, a, b, () => -0.08), M.gravel));
      [-1, 1].forEach(s => addBoxSpan(g, s * 4.4, 1.5, -0.08, 0.45, a, b, M.concrete));    // pasillos de evacuación
    }
    // Puntales de lado a lado cada 25 m en las trincheras hondas
    const n = Math.floor((a - b) / 25);
    for (let i = 0; i < n; i++) {
      const z = a - 12 - i * 25, h = rel(z);
      if (h < 5 || station) continue;
      addBox(g, CORRIDOR * 2, 0.6, 0.6, M.concrete, 0, h - 0.4, z);
    }
  }

  buildStreetFurniture(g, M, zA, zB, rel) {
    const zs = [];
    for (let z = Math.ceil(zB / 30) * 30; z < zA; z += 30) zs.push(z);
    if (!zs.length) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const n = zs.length * 2;
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.12, 8, 6), M.steel, n);
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.18, 0.4), M.lampHead, n);
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.22, 3, 6), M.trunk, n);
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.2, 0), M.leaves, n);
    let k = 0;
    for (const z of zs) for (const s of [-1, 1]) {
      const y = rel(z) + 0.12;
      poles.setMatrixAt(k, m.compose(v.set(s * (WALK[0] + 0.6), y + 4, z), q, one));
      heads.setMatrixAt(k, m.compose(v.set(s * (WALK[0] - 0.1), y + 8, z), q, one));
      const tz = z + 15, ty = rel(tz) + 0.12;
      trunks.setMatrixAt(k, m.compose(v.set(s * (WALK[1] - 1.2), ty + 1.5, tz), q, one));
      crowns.setMatrixAt(k, m.compose(v.set(s * (WALK[1] - 1.2), ty + 4.2, tz), q, one));
      k++;
    }
    for (const mesh of [poles, heads, trunks, crowns]) { mesh.computeBoundingSphere(); g.add(mesh); }
    this.lampHeads = this.lampHeads || [];
    this.lampHeads.push(heads);
  }

  buildCatenaryMasts(g, M, zA, zB) {
    const cy = CONFIG.catenary.contactY;
    const zs = [];
    for (let z = Math.ceil(zB / 40) * 40; z < zA; z += 40) if (!this.inStation(z)) zs.push(z);
    if (!zs.length) return;
    const m = new THREE.Matrix4();
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, cy + 2.6, 0.3), M.steel, zs.length * 2);
    const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(11, 0.35, 0.3), M.steel, zs.length);
    zs.forEach((z, i) => {
      [-1, 1].forEach((s, j) => { m.makeTranslation(s * 5.4, (cy + 2.6) / 2, z); posts.setMatrixAt(i * 2 + j, m); });
      m.makeTranslation(0, cy + 2.45, z); beams.setMatrixAt(i, m);
    });
    posts.computeBoundingSphere(); beams.computeBoundingSphere();
    g.add(posts, beams);
  }

  /** Edificios a ambos lados de los tramos al aire libre (instanciados, colores variados). */
  buildBuildings(g, M) {
    const list = [];
    let seed = 1234;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const span of this.spans) {
      for (const s of [-1, 1]) {
        let z = span.zA - 5;
        while (z > span.zB + 5) {
          const d = 14 + rnd() * 22, w = 14 + rnd() * 18, h = rnd() < 0.15 ? 30 + rnd() * 40 : 7 + rnd() * 16;
          const x = s * (WALK[1] + 5 + w / 2 + rnd() * 6);
          const zc = z - d / 2;
          list.push({ x, z: zc, w, d, h, y: this.groundRel(zc) });
          z -= d + 3 + rnd() * 8;
        }
      }
    }
    if (!list.length) return;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mesh = new THREE.InstancedMesh(geo, M.building, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
    const palette = [0xd8d2c4, 0xc9c1b0, 0xb7c0c7, 0xe2dccf, 0xa9a399, 0xcfc6b8, 0x9fb0bd, 0xe6d3b8];
    list.forEach((b, i) => {
      mesh.setMatrixAt(i, m.compose(v.set(b.x, b.y, b.z), q, sc.set(b.w, b.h, b.d)));
      mesh.setColorAt(i, c.setHex(palette[i % palette.length]));
    });
    mesh.computeBoundingSphere();
    g.add(mesh);
  }

  /** Autos que circulan por la avenida cerca de la cámara (se reciclan al alejarse). */
  buildCars(g, M) {
    const N = 48;
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 1.0, 4.3), M.carBody, N);
    const cabin = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.6, 2.2), M.carGlass, N);
    const front = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.15, 0.05), M.headlight, N);
    const rear = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.15, 0.05), M.taillight, N);
    const colors = [0xc8ccd0, 0x1d2228, 0xf2f2f0, 0x8a1c1c, 0x2b4a7a, 0x6b6f73, 0xd9b44a, 0x3d6b4a];
    const c = new THREE.Color();
    this.cars = [];
    const lanes = [11, 14.5, 18];
    for (let i = 0; i < N; i++) {
      const side = i % 2 ? 1 : -1;
      this.cars.push({ side, x: side * lanes[i % 3], z: 0, v: 9 + Math.random() * 7, dir: side > 0 ? -1 : 1, placed: false });
      body.setColorAt(i, c.setHex(colors[i % colors.length]));
    }
    for (const mesh of [body, cabin, front, rear]) { mesh.frustumCulled = false; mesh.count = N; g.add(mesh); }
    this.carMeshes = { body, cabin, front, rear };
  }

  /* ---------------------------------------------------------------------
     Lluvia
     --------------------------------------------------------------------- */
  buildRain() {
    const N = this.rainN = 2600;
    const pos = new Float32Array(N * 6);
    this.rainDrops = Array.from({ length: N }, () => ({ x: (Math.random() - 0.5) * 50, y: Math.random() * 20 - 3, z: (Math.random() - 0.5) * 50, s: 0.8 + Math.random() * 0.4 }));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xaebccb, transparent: true, opacity: 0.45, depthWrite: false });
    this.rain = new THREE.LineSegments(geo, mat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  /**
   * @param {object|null} dry  zona sin lluvia (el tren en que se va: { x0, x1, z0, z1 }, mundo)
   */
  updateRain(dt, cam, amount, dry = null) {
    const show = amount > 0.02;
    this.rain.visible = show;
    if (!show) return;
    const pos = this.rain.geometry.attributes.position.array;
    const n = Math.floor(this.rainN * Math.min(1, amount));
    const fall = 11, len = 0.55;
    const roof = this.inStation(cam.z);                  // bajo la cubierta del andén no llueve
    for (let i = 0; i < this.rainN; i++) {
      const d = this.rainDrops[i];
      d.y -= fall * d.s * dt;
      if (d.y < -4) { d.y += 22; d.x = (Math.random() - 0.5) * 50; d.z = (Math.random() - 0.5) * 50; }
      const k = i * 6;
      const x = cam.x + d.x, y = cam.y + d.y, z = cam.z + d.z;
      const covered = (roof && Math.abs(x) < CORRIDOR && this.inStation(z))
        || (dry && x > dry.x0 && x < dry.x1 && z > dry.z0 && z < dry.z1);
      if (i >= n || covered) { pos.fill(0, k, k + 6); pos[k + 1] = pos[k + 4] = -1e4; continue; }
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      pos[k + 3] = x + 0.04; pos[k + 4] = y - len * d.s; pos[k + 5] = z;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
    this.rain.material.opacity = 0.25 + 0.3 * Math.min(1, amount);
  }

  /* ---------------------------------------------------------------------
     Cada fotograma
     --------------------------------------------------------------------- */

  /** Cuánto "afuera" está un punto de la vía (0..1), suavizado cerca de los portales. */
  exposureAt(z) {
    if (!this.spans.length) return 0;
    let k = 0;
    for (const dz of [-24, -12, 0, 12, 24]) k += this.sec.exposedAt(z + dz) ? 1 : 0;
    return k / 5;
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3} cam  posición de la cámara (mundo)
   * @param {number} clock       hora del juego
   * @param {object} o
   * @param {boolean} o.street   el pasajero está en la calle (la calle maneja el cielo)
   * @param {number} o.cityOutdoor  cuánto se ve la calle (0..1) mientras se sube por la salida
   * @param {object|null} o.dry  tren en que se va (zona sin lluvia: { x0, x1, z0, z1 })
   */
  update(dt, cam, clock, { street = false, cityOutdoor = 0, dry = null } = {}) {
    const target = street ? 0 : this.exposureAt(cam.z);
    this.exposure += THREE.MathUtils.clamp(target - this.exposure, -dt * 1.2, dt * 1.2);
    const f = this.exposure;
    this.group.visible = !street && (f > 0 || this.nearOpen(cam.z));
    const sky = skyAt(clock);
    this.sky = sky;

    // Cielo y niebla (si la calle no los está manejando)
    if (!street && cityOutdoor <= 0) {
      this.scene.background.copy(TUNNEL_BG).lerp(sky.color, f);
      this.scene.fog.color.copy(TUNNEL_BG).lerp(sky.color, f);
      const far = 330 - 120 * WEATHER.rain;
      this.scene.fog.near = 30 + (60 - 30) * f;
      this.scene.fog.far = 240 + (far - 240) * f;
    }
    const light = street ? 0 : f;
    this.sun.intensity = 2.4 * sky.light * light;
    this.sun.color.setHex(sky.dusk > 0.4 ? 0xffb37a : 0xfff1dc);
    this.sun.position.set(cam.x - 60, cam.y + 120, cam.z + 40);
    this.sun.target.position.set(cam.x, cam.y, cam.z);
    this.hemi.intensity = (0.2 + 0.9 * sky.day * (1 - 0.3 * WEATHER.cloud)) * light;
    if (this.M) this.M.building.emissiveIntensity = sky.day < 0.35 ? 0.9 * (1 - sky.day / 0.35) : 0;

    // Lluvia: afuera (viaducto, trinchera o la calle)
    const outside = street ? 1 : f;
    this.updateRain(dt, cam, WEATHER.rain * outside, street ? null : dry);
    this.rainAmount = WEATHER.rain * outside;

    if (this.cars && this.group.visible) this.updateCars(dt, cam, sky);
  }

  /** ¿Hay un tramo al aire libre a menos de 400 m? (para dibujarlo desde el portal) */
  nearOpen(z) {
    return this.spans.some(s => z < s.zA + 400 && z > s.zB - 400);
  }

  updateCars(dt, cam, sky) {
    const { body, cabin, front, rear } = this.carMeshes;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), zero = new THREE.Vector3(0, 0, 0);
    const R = 320;
    this.cars.forEach((c, i) => {
      if (!c.placed || Math.abs(c.z - cam.z) > R) { c.z = cam.z + (Math.random() * 2 - 1) * R; c.placed = true; }
      c.z += c.dir * c.v * dt;
      const open = this.sec.exposedAt(c.z);
      const y = this.groundRel(c.z) + 0.1;
      q.setFromAxisAngle(_up, c.dir > 0 ? Math.PI : 0);
      const s = open ? one : zero;
      body.setMatrixAt(i, m.compose(v.set(c.x, y + 0.65, c.z), q, s));
      cabin.setMatrixAt(i, m.compose(v.set(c.x, y + 1.45, c.z + c.dir * 0.3), q, s));
      front.setMatrixAt(i, m.compose(v.set(c.x, y + 0.75, c.z + c.dir * 2.17), q, s));
      rear.setMatrixAt(i, m.compose(v.set(c.x, y + 0.75, c.z - c.dir * 2.17), q, s));
    });
    for (const mesh of [body, cabin, front, rear]) mesh.instanceMatrix.needsUpdate = true;
    front.visible = rear.visible = sky.day < 0.6 || WEATHER.rain > 0.3;
  }
}

const _up = new THREE.Vector3(0, 1, 0);
