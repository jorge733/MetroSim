/* ==========================================================================
   RedMoviSim — 2.19 · render/valparaiso.js
   El paisaje del Metro Valparaíso (línea bonus): el MAR y los CERROS.

   La línea va de oeste a este y en el juego avanza hacia −Z, así que mirando
   hacia Limache el mar queda a la IZQUIERDA (−X) y los cerros a la DERECHA (+X):
     · COSTA (Puerto … Recreo): la avenida, la costanera con su muro y las
       rocas, y el mar hasta el horizonte; enfrente, los cerros de Valparaíso
       con sus quebradas y casas de colores colgando de las laderas, y las grúas
       del puerto junto a la estación Puerto;
     · INTERIOR (El Salto … Limache): el valle de Quilpué y Villa Alemana, con
       cerros secos a los dos lados y el cerro La Campana al fondo.
   (Entre Recreo y El Salto el tren va bajo tierra por Viña del Mar.)

   Dos capas: lo CERCANO (hasta ~330 m, lo que alcanza a dibujar la cámara) es
   geometría de verdad que sigue el perfil de la vía (trackLift) y la niebla; lo
   LEJANO es un PANORAMA pintado en un lienzo, en el infinito como el cielo
   (render/realism.js → SkyDome): la línea del horizonte del mar y los cerros
   del fondo, con las luces de las casas de noche.
   ========================================================================== */

import * as THREE from "three";
import { STATIONS, WORLD } from "../config.js";
import { std, makeCanvas, toTexture } from "../utils.js";

/* ---------- Ruido determinista (mismo paisaje en cada partida) ---------- */
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y) => 0.55 * noise2(x, y) + 0.3 * noise2(x * 2.1 + 5, y * 2.1 + 9) + 0.15 * noise2(x * 4.3 + 11, y * 4.3 + 3);

/** Colores de las casas de los cerros de Valparaíso. */
const HOUSE_COLORS = [0xe94f37, 0xf6c445, 0x3a86c8, 0x47b39d, 0xf28c28, 0xd64e8a, 0x8bc34a, 0xf2efe6, 0x7a5cc8, 0x2fb5c9, 0xe8d8b0, 0xc0392b];
const ROOF_COLORS = [0x8f9599, 0x7b4a3a, 0xa3a8ab, 0x5f6b73, 0x9a5b42];

/**
 * Zonas de la línea en z del mundo: la costa (Puerto … Recreo) y el interior (El Salto … Limache).
 * null si la línea activa no es la de Valparaíso.
 */
export function valpoZones() {
  const z = (name) => STATIONS.find(s => s.name === name)?.z;
  const recreo = z("RECREO"), salto = z("EL SALTO");
  if (recreo === undefined || salto === undefined) return null;
  return {
    coast: [WORLD.start, recreo - 350],         // hasta poco antes del túnel de Viña
    inland: [salto + 400, WORLD.end],
    split: (recreo + salto) / 2,                 // de aquí hacia Limache, el panorama del interior
    inCoast(zz) { return zz <= this.coast[0] && zz >= this.coast[1]; },
    inInland(zz) { return zz <= this.inland[0] && zz >= this.inland[1]; },
  };
}

/* ==========================================================================
   Lo cercano: mar, costanera, cerros con casas y grúas
   ========================================================================== */

/**
 * @param {THREE.Group} g
 * @param {object} o
 * @param {(z:number)=>number} o.rel   altura de la calle respecto del carril
 * @param {Function} o.flatRibbon      cintas del módulo outdoor.js
 * @param {Function} o.wallRibbon
 * @param {number} o.walk              borde exterior de la vereda (|x|)
 * @param {object} o.zones             valpoZones()
 * @param {THREE.Material} o.building  material de fachadas (ventanas de noche)
 */
export function buildValpoNear(g, { rel, flatRibbon, wallRibbon, walk, zones }) {
  const face = houseCanvases();
  const M = {
    house: std(0xffffff, { map: toTexture(face.day), rough: 0.85, emissive: 0xffffff, emissiveIntensity: 0 }),
    sea: std(0xffffff, { map: toTexture(seaCanvas(), 1, 1), rough: 0.18, metal: 0.25 }),
    promenade: std(0xb9b2a3, { rough: 0.85 }),
    seawall: std(0x8a877f, { rough: 0.95, side: THREE.DoubleSide }),
    rock: std(0x4d4a45, { rough: 1 }),
    hill: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
    roof: std(0xffffff, { rough: 0.7, metal: 0.3 }),
    crane: std(0xd8432c, { rough: 0.6, metal: 0.4 }),
  };
  const out = { M };
  const [cA, cB] = zones.coast, [iA, iB] = zones.inland;
  const SEA_X = walk + 10;                       // de la vereda al muro de la costanera
  const SEA_DROP = 1.1;                          // el mar, un poco bajo la costanera

  // --- Costa: costanera, muro, rocas y mar (a la izquierda) ---
  if (cA - cB > 10) {
    g.add(new THREE.Mesh(flatRibbon(-walk, -SEA_X, cA, cB, z => rel(z) + 0.12), M.promenade));
    g.add(new THREE.Mesh(wallRibbon(-SEA_X, cA, cB, z => rel(z) - SEA_DROP - 0.6, z => rel(z) + 0.35, 1), M.seawall));
    g.add(new THREE.Mesh(flatRibbon(-SEA_X, -SEA_X - 0.5, cA, cB, z => rel(z) + 0.4), M.seawall));
    const sea = new THREE.Mesh(flatRibbon(-SEA_X, -340, cA + 300, cB - 200, z => rel(Math.min(cA, Math.max(cB, z))) - SEA_DROP, 20), M.sea);
    sea.material.map.repeat.set(12, 0.08);
    g.add(sea);
    out.seaTex = M.sea.map;
    // Rocas al pie del muro
    const rocks = [];
    let k = 0;
    for (let z = cA; z > cB; z -= 2.2 + hash2(k, 1) * 3) {
      k++;
      rocks.push({ x: -SEA_X - 1.5 - hash2(k, 2) * 5, z, s: 1.2 + hash2(k, 3) * 2.2, r: hash2(k, 4) * 3 });
    }
    instanced(g, new THREE.DodecahedronGeometry(1, 0), M.rock, rocks, (r, m) =>
      m.compose(new THREE.Vector3(r.x, rel(r.z) - SEA_DROP + r.s * 0.2, r.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(r.r, r.r * 2, r.r * 0.5)), new THREE.Vector3(r.s, r.s * 0.7, r.s)));
    // Grúas del puerto junto a la estación Puerto
    buildCranes(g, M.crane, rel, cA);
  }

  // --- Cerros con casas: costa a la derecha; interior a los dos lados ---
  const houses = [];
  if (cA - cB > 10) buildHill(g, M.hill, houses, { side: 1, x0: 78, x1: 330, zA: cA, zB: cB, rel, peak: 150, dense: 1, dry: false });
  if (iA - iB > 10) for (const side of [-1, 1])
    buildHill(g, M.hill, houses, { side, x0: 115, x1: 330, zA: iA, zB: iB, rel, peak: 70, dense: 0.22, dry: true });
  M.house.emissiveMap = toTexture(face.night);          // de noche se encienden las ventanas
  buildHouses(g, M.house, M.roof, houses);
  return out;
}

/** Ladera: malla de alturas que sube desde x0 (base) hasta x1, con quebradas cada ~380 m. */
function buildHill(g, mat, houses, { side, x0, x1, zA, zB, rel, peak, dense, dry }) {
  const DZ = 20, DX = 14;
  const nz = Math.max(1, Math.ceil((zA - zB) / DZ)), nx = Math.ceil((x1 - x0) / DX);
  const ravine = (z) => {                                       // 0 … 1 en el fondo de una quebrada
    const f = ((z / 380) % 1 + 1) % 1;
    return Math.exp(-(((f - 0.5) / 0.09) ** 2));
  };
  const height = (x, z) => {
    const d = Math.abs(x) - x0;
    const rise = 1 - Math.exp(-d / (dry ? 140 : 105));
    const amp = peak * (0.7 + 0.45 * fbm(z / 520 + side * 7, 3.1));
    return rel(z) + 1 + rise * amp * (1 - 0.38 * ravine(z) * Math.min(1, d / 60)) + 9 * fbm(x / 45, z / 45) * rise;
  };
  const pos = [], col = [], idx = [];
  const c = new THREE.Color(), low = new THREE.Color(dry ? 0x8c8a5c : 0x6e7f4a), high = new THREE.Color(dry ? 0x9c8f68 : 0x5c6b40), dirt = new THREE.Color(0x8f7a5a);
  for (let i = 0; i <= nz; i++) {
    const z = zA - (zA - zB) * i / nz;
    for (let j = 0; j <= nx; j++) {
      const x = side * (x0 + (x1 - x0) * j / nx);
      pos.push(x, height(x, z), z);
      const t = j / nx, n = fbm(x / 30, z / 30);
      c.copy(low).lerp(high, t).lerp(dirt, 0.35 * n + (dry ? 0.15 : 0));
      col.push(c.r, c.g, c.b);
      if (i < nz && j < nx) {
        const a = i * (nx + 1) + j, b = a + nx + 1;
        if (side > 0) idx.push(a, a + 1, b, a + 1, b + 1, b);       // la cara mira hacia arriba
        else idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  g.add(new THREE.Mesh(geo, mat));

  // Casas en la ladera: más apretadas abajo, ninguna en el fondo de las quebradas
  let k = Math.floor(Math.abs(zA)) + (side > 0 ? 1 : 7);
  for (let z = zA - 4; z > zB + 4; z -= 3.2 / dense) {
    for (let tries = 0; tries < 3; tries++) {
      k++;
      const d = Math.pow(hash2(k, 11), 1.6) * (x1 - x0 - 30) + 4;
      if (hash2(k, 12) > 0.85 - 0.25 * (d / (x1 - x0)) || ravine(z) > 0.55) continue;
      const x = side * (x0 + d), w = 5 + hash2(k, 13) * 4, dd = 5 + hash2(k, 14) * 3, h = 4 + hash2(k, 15) * (dry ? 3 : 6);
      const y = height(x, z);
      houses.push({ x, z: z + hash2(k, 16) * 3, w, d: dd, h, y: y - 2.5, color: HOUSE_COLORS[(k * 7) % HOUSE_COLORS.length], roof: ROOF_COLORS[k % ROOF_COLORS.length], rot: (hash2(k, 17) - 0.5) * 0.5 });
    }
  }
}

/** Casas (cajas con la fachada de ventanas) y sus techos de zinc o teja, instanciadas. */
function buildHouses(g, building, roofMat, houses) {
  if (!houses.length) return;
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const c = new THREE.Color(), q = new THREE.Quaternion(), e = new THREE.Euler();
  instanced(g, box, building, houses, (h, m, i, mesh) => {
    mesh.setColorAt(i, c.setHex(h.color));
    return m.compose(new THREE.Vector3(h.x, h.y, h.z), q.setFromEuler(e.set(0, h.rot, 0)), new THREE.Vector3(h.w, h.h + 2.5, h.d));
  });
  const roof = new THREE.BoxGeometry(1, 1, 1);
  roof.translate(0, 0.5, 0);
  instanced(g, roof, roofMat, houses, (h, m, i, mesh) => {
    mesh.setColorAt(i, c.setHex(h.roof));
    return m.compose(new THREE.Vector3(h.x, h.y + h.h + 2.5, h.z), q.setFromEuler(e.set(0.08, h.rot, 0)), new THREE.Vector3(h.w + 0.6, 0.45, h.d + 0.6));
  });
}

/** Tres grúas de pórtico del puerto, entre el mar y la avenida, cerca de la estación Puerto. */
function buildCranes(g, mat, rel, zStart) {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const z = zStart - 60 - i * 70, x = -70 - i * 6, y = rel(z) - 1.1;
    parts.push([x - 6, y + 14, z, 1.2, 28, 1.2], [x + 6, y + 14, z, 1.2, 28, 1.2], [x, y + 28.5, z, 14, 1.6, 1.6],
      [x - 14, y + 33, z, 44, 1.4, 1.4], [x, y + 31, z, 3, 4, 3]);
  }
  instanced(g, new THREE.BoxGeometry(1, 1, 1), mat, parts, (p, m) =>
    m.compose(new THREE.Vector3(p[0], p[1], p[2]), new THREE.Quaternion(), new THREE.Vector3(p[3], p[4], p[5])));
}

/** Malla instanciada a partir de una lista y una función que da la matriz de cada elemento. */
function instanced(g, geo, mat, list, place) {
  if (!list.length) return null;
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  const m = new THREE.Matrix4();
  list.forEach((it, i) => mesh.setMatrixAt(i, place(it, m, i, mesh) || m));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  g.add(mesh);
  return mesh;
}

/** Fachada de una casa de cerro: muro blanco (se tiñe con el color de la casa), puerta y dos ventanas. */
function houseCanvases() {
  const S = 64, day = makeCanvas(S, S), night = makeCanvas(S, S), d = day.getContext("2d"), n = night.getContext("2d");
  d.fillStyle = "#f4f1ea"; d.fillRect(0, 0, S, S);
  n.fillStyle = "#000"; n.fillRect(0, 0, S, S);
  for (const [x, y, w, h, lit] of [[8, 14, 16, 16, true], [40, 14, 16, 16, false], [26, 38, 12, 26, false]]) {
    d.fillStyle = h > 20 ? "#5b3b2a" : "#2a3b47"; d.fillRect(x, y, w, h);
    d.fillStyle = "#ffffff"; d.fillRect(x - 2, y + h, w + 4, 2);
    if (lit) { n.fillStyle = "#ffd98a"; n.fillRect(x, y, w, h); }
  }
  return { day, night };
}

/** Textura del mar: azul con reflejos y crestas de ola en franjas. */
function seaCanvas() {
  const W = 256, H = 256, c = makeCanvas(W, H), x = c.getContext("2d");
  const grad = x.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, "#2f7aa0"); grad.addColorStop(1, "#1f5f86");
  x.fillStyle = grad; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) {
    const yy = hash2(i, 1) * H, xx = hash2(i, 2) * W, w = 8 + hash2(i, 3) * 40;
    x.fillStyle = `rgba(${hash2(i, 4) > 0.8 ? "255,255,255" : "120,190,220"},${0.15 + hash2(i, 5) * 0.3})`;
    x.fillRect(xx, yy, w, 1 + hash2(i, 6) * 2);
  }
  return c;
}

/* ==========================================================================
   Lo lejano: panorama en el infinito (horizonte del mar y cerros del fondo)
   ========================================================================== */

/** Elevación (tangente) que cubre el lienzo: de E0 (bajo el horizonte) a E1. */
const E0 = -0.12, E1 = 0.38;

const PANO_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
  gl_Position.z = gl_Position.w * 0.99998;
}`;

const PANO_FRAG = /* glsl */ `
uniform sampler2D uCoastDay, uCoastNight, uInlandDay, uInlandNight;
uniform float uCoast, uLight, uNight, uOpacity;
uniform vec3 uHaze;
varying vec3 vDir;
void main() {
  float e = vDir.y / max(length(vDir.xz), 1e-3);
  float v = (e - ${E0.toFixed(3)}) / ${(E1 - E0).toFixed(3)};
  if (v < 0.0 || v > 1.0) discard;
  vec2 uv = vec2(atan(vDir.x, -vDir.z) / 6.2831853 + 0.5, v);
  vec4 day = mix(texture2D(uInlandDay, uv), texture2D(uCoastDay, uv), uCoast);
  vec3 lit = mix(texture2D(uInlandNight, uv).rgb, texture2D(uCoastNight, uv).rgb, uCoast);
  if (day.a < 0.02) discard;
  vec3 col = day.rgb * (0.12 + 0.88 * uLight);
  col = mix(col, uHaze, 0.32 + 0.25 * uLight * (1.0 - v));
  col += lit * uNight;
  gl_FragColor = vec4(col, day.a * uOpacity);
  #include <colorspace_fragment>
}`;

export class ValpoPanorama extends THREE.Mesh {
  constructor() {
    const tex = (c) => { const t = toTexture(c); t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 4; return t; };
    const coast = paintPanorama("coast"), inland = paintPanorama("inland");
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uCoastDay: { value: tex(coast.day) }, uCoastNight: { value: tex(coast.night) },
        uInlandDay: { value: tex(inland.day) }, uInlandNight: { value: tex(inland.night) },
        uCoast: { value: 1 }, uLight: { value: 1 }, uNight: { value: 0 }, uOpacity: { value: 1 },
        uHaze: { value: new THREE.Color(0xdfe9f2) },
      },
      vertexShader: PANO_VERT, fragmentShader: PANO_FRAG,
      side: THREE.BackSide, depthWrite: false, fog: false, transparent: true,
    });
    super(new THREE.CylinderGeometry(1, 1, 1.2, 96, 1, true), mat);
    this.frustumCulled = false;
    this.renderOrder = -9;                        // justo después del cielo, antes de todo lo demás
    this.name = "valpoPanorama";
  }

  /** Luz, niebla y qué panorama se ve (costa o interior) según la cámara. */
  set({ coast, sky, horizon, opacity }) {
    const u = this.material.uniforms;
    u.uCoast.value += (coast - u.uCoast.value) * 0.2;
    u.uLight.value = sky.light;
    u.uNight.value = THREE.MathUtils.clamp(1 - sky.day / 0.35, 0, 1);
    u.uHaze.value.copy(horizon);
    u.uOpacity.value = opacity;
    this.visible = opacity > 0.001;
  }
}

/**
 * Pinta un panorama de 360° (u: ángulo, 0,5 = hacia Limache; 0,25 = izquierda; 0,75 = derecha).
 * Devuelve el lienzo de día (con transparencia sobre los cerros) y el de las luces de noche.
 */
function paintPanorama(kind) {
  const W = 2048, H = 512;
  const day = makeCanvas(W, H), night = makeCanvas(W, H);
  const d = day.getContext("2d"), n = night.getContext("2d");
  n.fillStyle = "#000"; n.fillRect(0, 0, W, H);
  const yOf = (e) => H * (1 - (e - E0) / (E1 - E0));
  const horizon = yOf(0);
  const coast = kind === "coast";

  // Mar (costa: izquierda y atrás) hasta el horizonte
  if (coast) {
    const g = d.createLinearGradient(0, horizon, 0, H);
    g.addColorStop(0, "#8fb7c9"); g.addColorStop(0.08, "#3f86a8"); g.addColorStop(1, "#1d5a80");
    d.fillStyle = g; d.fillRect(0, horizon, W, H - horizon);
    for (let i = 0; i < 900; i++) {                                  // brillos de las olas
      const y = horizon + Math.pow(hash2(i, 31), 1.8) * (H - horizon), x = hash2(i, 32) * W;
      d.fillStyle = `rgba(220,240,250,${0.08 + 0.2 * hash2(i, 33)})`;
      d.fillRect(x, y, 4 + 30 * hash2(i, 34) * (y - horizon) / (H - horizon), 1);
    }
  }

  // Silueta de los cerros: elevación (tangente) según el ángulo
  const ridge = (u) => {
    const a = u * Math.PI * 2;
    const wob = 0.018 * (fbm(u * 18, 1.7) - 0.5) + 0.01 * (fbm(u * 60, 4.2) - 0.5);
    if (coast) {
      // Derecha (u 0,5 … 1): los cerros de Valparaíso; izquierda: el mar, con la costa de Viña y Reñaca al frente
      if (u > 0.5) return Math.max(0, 0.06 + 0.15 * Math.sin((u - 0.5) * 2 * Math.PI) ** 0.7 + wob) * smooth(0.5, 0.56, u) * (1 - smooth(0.96, 1.0, u));
      return Math.max(0, 0.022 + wob * 0.6) * smooth(0.34, 0.46, u) * (1 - smooth(0.49, 0.5, u) * 0);
    }
    // Interior: cerros a los dos lados, más bajos atrás; el cerro La Campana al frente a la izquierda
    const campana = 0.13 * Math.exp(-(((u - 0.43) / 0.025) ** 2));
    return 0.045 + 0.03 * Math.abs(Math.sin(a)) + campana + wob * 1.4;
  };
  // Cordón más lejano (más azulado), detrás
  const far = (u) => ridge(u) * 0.75 + 0.03 * fbm(u * 9, 8.3) + (coast && u < 0.5 ? -1 : 0);

  const fill = (fn, color, lights) => {
    d.fillStyle = color;
    d.beginPath(); d.moveTo(0, H);
    for (let x = 0; x <= W; x += 2) { const e = fn(x / W); d.lineTo(x, e > 0 ? yOf(e) : H); }
    d.lineTo(W, H); d.closePath(); d.fill();
    if (!lights) return;
    // Casas de colores y, de noche, sus ventanas encendidas
    for (let i = 0; i < lights; i++) {
      const u = hash2(i, 51), e = fn(u);
      if (e < 0.01) continue;
      const t = Math.pow(hash2(i, 52), 1.3) * 0.85;                 // más casas abajo
      const y = yOf(e * (1 - t)) + 2, x = u * W;
      if (y > (coast ? horizon : H) - 1) continue;
      const col = HOUSE_COLORS[i % HOUSE_COLORS.length];
      d.fillStyle = "#" + col.toString(16).padStart(6, "0");
      d.fillRect(x, y, 2 + hash2(i, 53) * 2, 1.5 + hash2(i, 54) * 1.5);
      if (hash2(i, 55) < 0.45) { n.fillStyle = `rgba(255,${200 + 40 * hash2(i, 56) | 0},120,${0.6 + 0.4 * hash2(i, 57)})`; n.fillRect(x, y, 1.5, 1.5); }
    }
  };
  fill(far, coast ? "#7d8c86" : "#8a9296", 0);
  fill(ridge, coast ? "#66724c" : "#7f7a55", coast ? 9000 : 1800);
  if (!coast) {                                                    // suelo del valle bajo el horizonte
    d.fillStyle = "#7c7a52"; d.fillRect(0, horizon, W, H - horizon);
  }
  return { day, night };
}

function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
