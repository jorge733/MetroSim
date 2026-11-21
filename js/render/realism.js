/* ==========================================================================
   RedMoviSim — 2.4 · render/realism.js
   Lo que hace que la calle se vea más real, compartido por la calle del
   bus/taxi (bus/busWorld.js), la calle de la estación (city/city.js) y el
   Metro al aire libre (render/outdoor.js):

     · CIELO con degradado (azul profundo arriba, bruma clara en el
       horizonte), el disco y el halo del sol y nubes que se mueven. La
       niebla toma el color del horizonte, así lo lejano se funde con él.
     · SOL que sale por la cordillera (oriente), pasa por el norte y se pone
       por el poniente, con SOMBRAS suaves que siguen a la cámara.
     · TEXTURAS hechas en canvas (sin archivos): asfalto con grano, parches y
       grietas; baldosas de vereda; pasto; fachadas con marcos, vidrios que
       reflejan el cielo, cortinas, aire acondicionado y manchas de lluvia.
     · COPAS de árbol hechas de varios bultos, más oscuras abajo (sombra
       propia), en vez de una sola esfera facetada.
     · Coordenadas de textura «del mundo»: el asfalto y las baldosas tienen
       el mismo tamaño en cualquier pieza, y las fachadas se reparten por
       pisos según el alto real de cada edificio.

   Todo está pensado para el celular: una sola luz con sombra, mapa de
   sombras chico en pantallas táctiles y texturas pequeñas que se repiten.
   ========================================================================== */

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Pantalla táctil (celular/tablet): sombras más livianas. */
export const LOW_END = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/* ==========================================================================
   Cielo
   ========================================================================== */

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  // Solo la rotación de la cámara: el cielo está «en el infinito» y siempre detrás de todo
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
  gl_Position.z = gl_Position.w * 0.99999;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSun;
uniform float uCloud;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uTime;
uniform float uOpacity;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.5));
  col = mix(col, uGround, smoothstep(0.0, -0.06, h));
  // Sol: disco y halo (más ancho cuando está bajo)
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * uSun * (pow(s, 900.0) * 6.0 + pow(s, 24.0) * 0.28 + pow(s, 4.0) * 0.12);
  // Nubes: ruido proyectado sobre un plano alto, más finas hacia el horizonte
  if (h > 0.0) {
    vec2 p = d.xz / (h + 0.12) * 1.6 + vec2(uTime * 0.006, uTime * 0.0025);
    float n = fbm(p);
    float cover = mix(0.58, 0.3, uCloud);
    float c = smoothstep(cover, cover + 0.22, n) * smoothstep(0.0, 0.18, h);
    float lit = clamp(0.55 + 0.6 * (n - fbm(p + uSunDir.xz * 0.08)) * 4.0, 0.0, 1.0);
    vec3 cc = mix(uCloudShade, uCloudLit, lit) + uSunColor * uSun * pow(s, 8.0) * 0.35;
    col = mix(col, cc, c * 0.92);
  }
  gl_FragColor = vec4(col, uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const C = (hex) => new THREE.Color(hex);

/**
 * Colores del cielo según la hora y las nubes (lo que da render/outdoor.js · skyAt).
 * `horizon` es también el color de la niebla.
 */
export function skyColors(sky) {
  const clear = 1 - sky.cloud;
  const top = sky.color.clone()
    .lerp(C(0x2f6fc4), 0.55 * sky.day * clear)              // cenit más profundo de día
    .lerp(C(0x05080f), 0.55 * (1 - sky.day))                // de noche, casi negro arriba
    .lerp(C(0x7d858d), 0.5 * sky.cloud * sky.day);
  const horizon = sky.color.clone()
    .lerp(C(0xdfe9f2), 0.42 * sky.day * clear)              // bruma clara de Santiago
    .lerp(C(0xffb27a), 0.35 * sky.dusk)                     // atardecer anaranjado
    .lerp(C(0x2a2630), 0.35 * (1 - sky.day));               // de noche, el resplandor de la ciudad
  const ground = horizon.clone().multiplyScalar(0.72);
  return { top, horizon, ground };
}

/**
 * Dirección hacia el sol (mundo) a una hora del día (s). Ejes: +X oriente
 * (la cordillera), −Z norte. En Santiago el sol sale por la cordillera, al
 * mediodía está hacia el norte y se pone por el poniente. De noche: la luna,
 * alta y fija.
 */
export function sunDirection(clock, out = new THREE.Vector3()) {
  const h = (clock / 3600) % 24;
  const a = Math.PI * (h - 6.8) / 13.6;
  if (a <= 0.05 || a >= Math.PI - 0.05) return out.set(-0.3, 0.85, 0.42).normalize();
  const elev = Math.sin(a);
  return out.set(Math.cos(a), 0.12 + 1.15 * elev, -0.55 * elev).normalize();
}

export class SkyDome extends THREE.Mesh {
  constructor() {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: C(0x2f6fc4) }, uHorizon: { value: C(0xdfe9f2) }, uGround: { value: C(0x6f747a) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: C(0xfff1dc) }, uSun: { value: 1 },
        uCloud: { value: 0.2 }, uCloudLit: { value: C(0xffffff) }, uCloudShade: { value: C(0xaab4c0) },
        uTime: { value: 0 }, uOpacity: { value: 1 },
      },
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    super(new THREE.SphereGeometry(1, 32, 16), mat);
    this.frustumCulled = false;
    this.renderOrder = -10;
    this.name = "skyDome";
    this.onBeforeRender = () => { mat.uniforms.uTime.value = performance.now() / 1000; };
  }

  /** Pone el cielo de la hora: colores, sol y nubes. Devuelve el color del horizonte (para la niebla). */
  set(sky, sunDir) {
    const u = this.material.uniforms, k = skyColors(sky);
    u.uTop.value.copy(k.top); u.uHorizon.value.copy(k.horizon); u.uGround.value.copy(k.ground);
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.set(sky.dusk > 0.3 ? 0xffb070 : 0xfff1dc);
    u.uSun.value = sky.day * (1 - 0.85 * sky.cloud);
    u.uCloud.value = Math.max(0.15, sky.cloud);
    u.uCloudLit.value.copy(C(0xffffff).lerp(C(0xffc79a), sky.dusk * 0.7).lerp(C(0x9aa3ad), sky.cloud * 0.5)).multiplyScalar(0.12 + 0.88 * sky.day);
    u.uCloudShade.value.copy(k.horizon).lerp(C(0x6b7480), 0.45).multiplyScalar(0.25 + 0.75 * sky.day);
    return k.horizon;
  }

  /** Opacidad (para aparecer de a poco al subir por la escalera del Metro). */
  setOpacity(f) {
    const m = this.material;
    m.uniforms.uOpacity.value = f;
    const t = f < 0.999;
    if (m.transparent !== t) { m.transparent = t; m.needsUpdate = true; }
    this.visible = f > 0.001;
  }
}

/* ==========================================================================
   Sol con sombras
   ========================================================================== */

export class SunShadow {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.DirectionalLight} light
   * @param {object} o  range: media anchura (m) del área con sombras alrededor de la cámara
   */
  constructor(renderer, light, { range = LOW_END ? 45 : 70 } = {}) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.light = light;
    this.range = range;
    const size = LOW_END ? 1024 : 2048;
    light.castShadow = true;
    light.shadow.mapSize.set(size, size);
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.04;
    light.shadow.radius = 3;
    const cam = light.shadow.camera;
    cam.left = cam.bottom = -range; cam.right = cam.top = range;
    cam.near = 1; cam.far = 600;
    cam.updateProjectionMatrix();
    this.dir = new THREE.Vector3(0, 1, 0);
    this.texel = (2 * range) / size;
  }

  /** Centra el área con sombras en `focus` (mundo), con el sol en la dirección `dir`. */
  follow(focus, dir = this.dir) {
    this.dir.copy(dir);
    // Se mueve de a un píxel del mapa de sombras: así los bordes no tiemblan al avanzar
    const t = this.texel;
    const fx = Math.round(focus.x / t) * t, fz = Math.round(focus.z / t) * t;
    const l = this.light, up = Math.max(0.18, dir.y);
    l.target.position.set(fx, 0, fz);
    l.position.set(fx + dir.x * 250, up * 250, fz + dir.z * 250);
    if (l.parent) l.parent.worldToLocal(l.position);
    if (l.target.parent) l.target.parent.worldToLocal(l.target.position);
    l.updateMatrixWorld();
    l.target.updateMatrixWorld();
  }
}

/** Marca que proyecta y/o recibe sombra en todo un árbol de objetos. */
export function shadows(root, { cast = true, receive = false } = {}) {
  root.traverse(o => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    // Los vidrios y letreros transparentes no tapan el sol
    o.castShadow = cast && !(m && (m.transparent || m.isMeshBasicMaterial));
    o.receiveShadow = receive && !(m && m.isMeshBasicMaterial);
  });
  return root;
}

/* ==========================================================================
   Texturas de canvas
   ========================================================================== */

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}
function texture(c, { srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}
/** Generador pseudoaleatorio con semilla (texturas iguales en cada partida). */
export function rng32(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Ruido de grano, en varias escalas (manchas grandes + grano fino). */
function grain(g, w, h, rnd, { fine = 24, blotch = 0.08, blotchSize = 40 } = {}) {
  for (let i = 0; i < (w * h) / (blotchSize * blotchSize) * 3; i++) {
    const x = rnd() * w, y = rnd() * h, r = blotchSize * (0.4 + rnd());
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const dark = rnd() < 0.5;
    grd.addColorStop(0, dark ? `rgba(0,0,0,${blotch})` : `rgba(255,255,255,${blotch * 0.7})`);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * fine;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}
/** Grieta: una línea quebrada fina. */
function crack(g, x, y, len, rnd) {
  g.beginPath(); g.moveTo(x, y);
  let a = rnd() * Math.PI * 2;
  for (let i = 0; i < 8; i++) { a += (rnd() - 0.5) * 1.2; x += Math.cos(a) * len / 8; y += Math.sin(a) * len / 8; g.lineTo(x, y); }
  g.stroke();
}

const cache = new Map();
const cached = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };

/** Asfalto (un cuadro = ASPHALT_TILE m): grano, parches más oscuros, manchas de aceite y grietas. */
export const ASPHALT_TILE = 8;
export function asphaltTexture({ base = "#3d4044" } = {}) {
  return cached("asphalt" + base, () => {
    const W = 512, c = canvas(W, W), g = c.getContext("2d"), rnd = rng32(7);
    g.fillStyle = base; g.fillRect(0, 0, W, W);
    grain(g, W, W, rnd, { fine: 30, blotch: 0.06, blotchSize: 60 });
    // Parches de bacheo (rectángulos algo más oscuros o claros)
    for (let i = 0; i < 3; i++) {
      const w = 60 + rnd() * 120, h = 40 + rnd() * 90, x = rnd() * W, y = rnd() * W;
      g.fillStyle = rnd() < 0.6 ? "rgba(10,10,12,.09)" : "rgba(255,255,255,.035)";
      g.fillRect(x, y, w, h);
      g.strokeStyle = "rgba(0,0,0,.16)"; g.lineWidth = 1.5; g.strokeRect(x, y, w, h);
    }
    // Manchas de aceite en el centro de la pista
    for (let i = 0; i < 6; i++) {
      const x = W * (0.3 + rnd() * 0.4), y = rnd() * W, r = 10 + rnd() * 26;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, "rgba(8,8,10,.35)"); grd.addColorStop(1, "rgba(8,8,10,0)");
      g.fillStyle = grd; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    g.strokeStyle = "rgba(15,15,17,.55)"; g.lineWidth = 1.2;
    for (let i = 0; i < 7; i++) crack(g, rnd() * W, rnd() * W, 40 + rnd() * 90, rnd);
    return texture(c);
  });
}
/** Rugosidad del asfalto (más liso donde pasan las ruedas): sirve para que brille mojado. */
export function asphaltRoughness() {
  return cached("asphaltRough", () => {
    const W = 256, c = canvas(W, W), g = c.getContext("2d"), rnd = rng32(9);
    g.fillStyle = "#e6e6e6"; g.fillRect(0, 0, W, W);
    grain(g, W, W, rnd, { fine: 50, blotch: 0.25, blotchSize: 30 });
    return texture(c, { srgb: false });
  });
}

/** Baldosas de vereda (un cuadro = PAVER_TILE m): losetas de 40 cm con juntas, desgaste y manchas. */
export const PAVER_TILE = 2.4;
export function paverTexture({ base = "#b3ada2" } = {}) {
  return cached("paver" + base, () => {
    const W = 512, c = canvas(W, W), g = c.getContext("2d"), rnd = rng32(11);
    g.fillStyle = base; g.fillRect(0, 0, W, W);
    const n = 6, s = W / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const k = (rnd() - 0.5) * 22;
      g.fillStyle = `rgba(${k > 0 ? "255,255,255" : "0,0,0"},${Math.abs(k) / 255 * 2.2})`;
      g.fillRect(i * s, j * s, s, s);
      // Textura de botones (vereda chilena) en algunas losetas
      if (rnd() < 0.18) {
        g.fillStyle = "rgba(0,0,0,.07)";
        for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) { g.beginPath(); g.arc(i * s + (a + 0.5) * s / 5, j * s + (b + 0.5) * s / 5, s / 18, 0, 7); g.fill(); }
      }
    }
    grain(g, W, W, rnd, { fine: 26, blotch: 0.09, blotchSize: 70 });
    g.strokeStyle = "rgba(40,36,32,.45)"; g.lineWidth = 2.5;
    for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, W); g.stroke(); g.beginPath(); g.moveTo(0, i * s); g.lineTo(W, i * s); g.stroke(); }
    g.strokeStyle = "rgba(255,255,255,.12)"; g.lineWidth = 1;
    for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s + 2, 0); g.lineTo(i * s + 2, W); g.stroke(); g.beginPath(); g.moveTo(0, i * s + 2); g.lineTo(W, i * s + 2); g.stroke(); }
    // Chicles y manchas
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(30,30,30,${0.1 + rnd() * 0.2})`; g.beginPath(); g.arc(rnd() * W, rnd() * W, 1.5 + rnd() * 3, 0, 7); g.fill(); }
    return texture(c);
  });
}

/** Pasto (un cuadro = GRASS_TILE m), con matas y tierra. */
export const GRASS_TILE = 6;
export function grassTexture({ base = "#557a3c" } = {}) {
  return cached("grass" + base, () => {
    const W = 256, c = canvas(W, W), g = c.getContext("2d"), rnd = rng32(13);
    g.fillStyle = base; g.fillRect(0, 0, W, W);
    grain(g, W, W, rnd, { fine: 34, blotch: 0.16, blotchSize: 36 });
    for (let i = 0; i < 1600; i++) {
      const x = rnd() * W, y = rnd() * W, l = 2 + rnd() * 4;
      g.strokeStyle = rnd() < 0.5 ? "rgba(140,170,80,.35)" : "rgba(20,40,10,.3)";
      g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 2, y - l); g.stroke();
    }
    for (let i = 0; i < 6; i++) {               // tierra pisada
      const x = rnd() * W, y = rnd() * W, r = 8 + rnd() * 16;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, "rgba(110,90,60,.45)"); grd.addColorStop(1, "rgba(110,90,60,0)");
      g.fillStyle = grd; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    return texture(c);
  });
}

/**
 * Fachada de edificio para edificios en serie (bus/busWorld.js): FACADE.bays
 * ventanas de ancho × FACADE.floors pisos. Devuelve tres texturas que
 * comparten el dibujo: color (muro blanco para teñirlo por edificio),
 * rugosidad (el vidrio es liso y refleja el cielo; también dice qué es muro)
 * y ventanas encendidas de noche.
 */
export const FACADE = { bays: 4, floors: 4, bay: 3.6, floor: 3.3 };
export function facadeSet(kind = "office") {
  return cached("facade-" + kind, () => {
    const W = 512, H = 512, rnd = rng32(kind === "office" ? 21 : 23);
    const col = canvas(W, H), rough = canvas(W, H), emis = canvas(W, H);
    const g = col.getContext("2d"), r = rough.getContext("2d"), e = emis.getContext("2d");
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H);
    r.fillStyle = "#ffffff"; r.fillRect(0, 0, W, H);
    e.fillStyle = "#000000"; e.fillRect(0, 0, W, H);
    grain(g, W, H, rnd, { fine: 14, blotch: 0.05, blotchSize: 80 });
    const bw = W / FACADE.bays, fh = H / FACADE.floors;
    const glassy = kind === "glass";
    for (let f = 0; f < FACADE.floors; f++) {
      // Losa entre pisos
      g.fillStyle = "rgba(0,0,0,.10)"; g.fillRect(0, f * fh, W, glassy ? 6 : 10);
      for (let b = 0; b < FACADE.bays; b++) {
        const x0 = b * bw, y0 = f * fh;
        const wx = x0 + bw * (glassy ? 0.04 : 0.16), ww = bw * (glassy ? 0.92 : 0.68);
        const wy = y0 + fh * (glassy ? 0.1 : 0.22), wh = fh * (glassy ? 0.86 : 0.56);
        // Marco
        g.fillStyle = glassy ? "#59626b" : "#8d8e8c"; g.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
        // Vidrio: refleja el cielo (más claro arriba) con un brillo en diagonal
        const grd = g.createLinearGradient(0, wy, 0, wy + wh);
        const tint = glassy ? [74, 102, 128] : [52, 64, 78];
        grd.addColorStop(0, `rgb(${tint[0] + 70},${tint[1] + 70},${tint[2] + 70})`);
        grd.addColorStop(0.55, `rgb(${tint[0]},${tint[1]},${tint[2]})`);
        grd.addColorStop(1, `rgb(${tint[0] - 20},${tint[1] - 20},${tint[2] - 18})`);
        g.fillStyle = grd; g.fillRect(wx, wy, ww, wh);
        g.fillStyle = "rgba(255,255,255,.10)";
        g.beginPath(); g.moveTo(wx + ww * 0.15, wy); g.lineTo(wx + ww * 0.45, wy); g.lineTo(wx + ww * 0.1, wy + wh); g.lineTo(wx - ww * 0.2 < wx ? wx : wx, wy + wh); g.fill();
        // Cortinas o persianas a medio bajar en algunas ventanas
        const blind = rnd();
        if (blind < 0.35) {
          g.fillStyle = ["#d9d2c3", "#c9c2b5", "#e8e2d6", "#a99e8c"][Math.floor(rnd() * 4)];
          const k = 0.2 + rnd() * 0.6;
          g.fillRect(wx, wy, ww, wh * k);
          g.fillStyle = "rgba(0,0,0,.08)";
          for (let y = wy; y < wy + wh * k; y += 5) g.fillRect(wx, y, ww, 1);
        }
        // Parteluz
        g.fillStyle = glassy ? "#59626b" : "#8d8e8c";
        g.fillRect(wx + ww / 2 - 2, wy, 4, wh);
        if (!glassy) {
          // Alféizar y mancha de lluvia que baja desde él
          g.fillStyle = "#cfcac0"; g.fillRect(wx - 6, wy + wh + 2, ww + 12, 6);
          const st = g.createLinearGradient(0, wy + wh + 8, 0, y0 + fh + 12);
          st.addColorStop(0, "rgba(40,36,30,.18)"); st.addColorStop(1, "rgba(40,36,30,0)");
          g.fillStyle = st; g.fillRect(wx + ww * 0.1, wy + wh + 8, ww * 0.8, y0 + fh - (wy + wh) + 4);
          // Aire acondicionado colgando
          if (rnd() < 0.12) { g.fillStyle = "#e4e4e0"; g.fillRect(wx + ww * 0.6, wy + wh - 26, 34, 24); g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(wx + ww * 0.6 + 4, wy + wh - 22, 26, 2); }
        }
        // Rugosidad: el vidrio es liso (y no se tiñe con el color del edificio)
        r.fillStyle = "#1c1c1c"; r.fillRect(wx, wy, ww, wh);
        // De noche: algunas ventanas encendidas (cálidas o frías)
        if (rnd() < 0.42) {
          e.fillStyle = rnd() < 0.7 ? "#ffd690" : "#e8f0ff";
          e.fillRect(wx, wy + (blind < 0.35 ? wh * 0.3 : 0), ww, wh * (blind < 0.35 ? 0.7 : 1));
        }
      }
    }
    // Suciedad que se acumula abajo y en la azotea
    const dirt = g.createLinearGradient(0, H - 60, 0, H);
    dirt.addColorStop(0, "rgba(50,45,38,0)"); dirt.addColorStop(1, "rgba(50,45,38,.12)");
    g.fillStyle = dirt; g.fillRect(0, H - 60, W, 60);
    const map = texture(col), roughnessMap = texture(rough, { srgb: false }), emissiveMap = texture(emis);
    return { map, roughnessMap, emissiveMap };
  });
}

/* ==========================================================================
   Coordenadas de textura del mundo
   ========================================================================== */

/** Encadena un cambio de shader con el doblado de la vía (render/trackLift.js), que va en el prototipo. */
function chainShader(mat, key, edit) {
  mat.onBeforeCompile = function (shader, renderer) {
    edit(shader);
    THREE.Material.prototype.onBeforeCompile.call(this, shader, renderer);
  };
  mat.customProgramCacheKey = function () {
    return THREE.Material.prototype.customProgramCacheKey.call(this) + "|" + key;
  };
  mat.needsUpdate = true;
  return mat;
}

/**
 * La textura se pega según la posición en el MUNDO (un cuadro cada `tile` m):
 * el piso usa x-z y los costados x-y o z-y. Así el asfalto, las baldosas y el
 * pasto tienen el mismo tamaño en piezas de cualquier largo.
 */
export function worldUV(mat, tile) {
  return chainShader(mat, "worldUV" + tile, (sh) => {
    sh.uniforms.uWorldTile = { value: 1 / tile };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uWorldTile;")
      .replace("#include <project_vertex>", `
        {
          vec4 rwp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            rwp = instanceMatrix * rwp;
          #endif
          rwp = modelMatrix * rwp;
          vec3 rn = abs(normalize(mat3(modelMatrix) * objectNormal));
          vec2 ruv = rn.y > 0.6 ? rwp.xz : (rn.x > rn.z ? rwp.zy : rwp.xy);
          ruv *= uWorldTile;
          #ifdef USE_MAP
            vMapUv = ruv;
          #endif
          #ifdef USE_ROUGHNESSMAP
            vRoughnessMapUv = ruv * 1.37;
          #endif
        }
        #include <project_vertex>`);
  });
}

/**
 * Fachadas de edificios en serie (InstancedMesh de cajas de 1×1×1 escaladas):
 * las ventanas se reparten por pisos y vanos según el tamaño real de cada
 * edificio (no se estiran), cada edificio muestra otra parte del dibujo, el
 * color del edificio tiñe solo el muro (no el vidrio) y la azotea es de
 * hormigón.
 */
export function facadeUV(mat) {
  return chainShader(mat, "facadeUV", (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vRoof;")
      .replace("#include <project_vertex>", `
        {
          #ifdef USE_INSTANCING
            vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
            vec3 ip = instanceMatrix[3].xyz;
          #else
            vec3 sc = vec3(1.0); vec3 ip = vec3(0.0);
          #endif
          vec3 lp = position * sc;
          vec3 an = abs(normal);
          float seed = fract(sin(dot(floor(ip.xz), vec2(12.9898, 78.233))) * 43758.5453);
          vec2 fuv = vec2(an.x > 0.5 ? lp.z : lp.x, lp.y + sc.y * 0.5);
          fuv = fuv / vec2(${(FACADE.bays * FACADE.bay).toFixed(2)}, ${(FACADE.floors * FACADE.floor).toFixed(2)}) + vec2(floor(seed * 4.0) * 0.25, floor(seed * 13.0) * 0.25);
          vRoof = an.y > 0.5 ? 1.0 : 0.0;
          #ifdef USE_MAP
            vMapUv = fuv;
          #endif
          #ifdef USE_ROUGHNESSMAP
            vRoughnessMapUv = fuv;
          #endif
          #ifdef USE_EMISSIVEMAP
            vEmissiveMapUv = fuv;
          #endif
        }
        #include <project_vertex>`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vRoof;")
      .replace("#include <color_fragment>", `
        float wallMask = 1.0;
        #ifdef USE_ROUGHNESSMAP
          wallMask = smoothstep(0.25, 0.6, texture2D(roughnessMap, vRoughnessMapUv).g);
        #endif
        #if defined( USE_COLOR_ALPHA )
          diffuseColor *= mix(vec4(1.0), vColor, wallMask);
        #elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
          diffuseColor.rgb *= mix(vec3(1.0), vColor, wallMask);
        #endif
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.31, 0.32), vRoof);`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.95, vRoof);`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        totalEmissiveRadiance *= 1.0 - vRoof;`);
  });
}

/* ==========================================================================
   Árboles
   ========================================================================== */

/**
 * Copa de árbol de varios bultos (radio ~1 m, centrada en 0), con color por
 * vértice: más oscura abajo y adentro (sombra propia), con matices por bulto.
 * Para usar con un material `vertexColors: true` (blanco o del tono del follaje).
 */
export function crownGeometry(seed = 1) {
  return cached("crown" + seed, () => {
    const rnd = rng32(seed * 97 + 3), parts = [];
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(), rad = i === 0 ? 0 : 0.45 + rnd() * 0.2;
      const r = i === 0 ? 0.8 : 0.5 + rnd() * 0.22;
      const geo = new THREE.IcosahedronGeometry(r, 1);
      geo.deleteAttribute("uv");
      geo.translate(Math.cos(a) * rad, (rnd() - 0.3) * 0.45 + (i === 0 ? 0.1 : 0), Math.sin(a) * rad);
      const hue = 0.85 + rnd() * 0.3;
      const p = geo.attributes.position, cols = new Float32Array(p.count * 3);
      for (let k = 0; k < p.count; k++) {
        // Bultos irregulares: cada vértice se mueve un poco (según su posición, para no abrir grietas)
        const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
        const hsh = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
        const j = 0.1 * ((hsh - Math.floor(hsh)) - 0.5);
        p.setXYZ(k, x * (1 + j), y * (1 + j), z * (1 + j));
        const out = Math.hypot(x, z);
        const shade = THREE.MathUtils.clamp(0.42 + 0.5 * (y + 0.6) / 1.4 + 0.1 * out + 1.2 * j, 0.3, 1.08) * hue;
        cols[k * 3] = shade * 0.95; cols[k * 3 + 1] = shade; cols[k * 3 + 2] = shade * 0.9;
      }
      geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
      parts.push(geo.index ? geo.toNonIndexed() : geo);
    }
    return mergeGeometries(parts);
  });
}

/** Tronco algo cónico con un par de ramas a la vista (alto 1 m, base en 0). */
export function trunkGeometry() {
  return cached("trunk", () => {
    const t = new THREE.CylinderGeometry(0.11, 0.2, 1, 7, 3);
    t.translate(0, 0.5, 0);
    const p = t.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) + Math.sin(y * 3.1) * 0.04); }
    const b1 = new THREE.CylinderGeometry(0.03, 0.07, 0.5, 5); b1.rotateZ(0.8); b1.translate(0.16, 0.85, 0);
    const b2 = new THREE.CylinderGeometry(0.03, 0.06, 0.45, 5); b2.rotateX(-0.8); b2.translate(0, 0.8, 0.14);
    return mergeGeometries([t, b1, b2].map(g => g.toNonIndexed()));
  });
}

/** Material del follaje: tono base × color por vértice (y × color por árbol si es InstancedMesh). */
export function leafMaterial(color = 0x4f7d3a) {
  return new THREE.MeshStandardMaterial({ color, vertexColors: true, roughness: 0.92, metalness: 0 });
}

/* ==========================================================================
   Luz de los faroles en el piso
   ========================================================================== */

/** Textura del círculo de luz cálida de un farol. */
export function lampPoolTexture() {
  return cached("lampPool", () => {
    const W = 128, c = canvas(W, W), g = c.getContext("2d");
    const grd = g.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
    grd.addColorStop(0, "rgba(255,214,150,1)"); grd.addColorStop(0.45, "rgba(255,190,120,.45)"); grd.addColorStop(1, "rgba(255,170,100,0)");
    g.fillStyle = grd; g.fillRect(0, 0, W, W);
    const t = texture(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** De noche: círculo de luz de un farol en el piso (se suma al color; no es una luz real). */
export function lampPool(parent, x, z, { size = 10, opacity = 0.5, y = 0.13 } = {}) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: lampPoolTexture(), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.renderOrder = 2;
  parent.add(m);
  return m;
}

/** Textura del halo de la ampolleta de un farol (se ve encendida a lo lejos). */
function lampHaloTexture() {
  return cached("lampHalo", () => {
    const W = 64, c = canvas(W, W), g = c.getContext("2d");
    const grd = g.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
    grd.addColorStop(0, "rgba(255,244,220,1)"); grd.addColorStop(0.18, "rgba(255,220,160,.75)");
    grd.addColorStop(0.5, "rgba(255,190,120,.18)"); grd.addColorStop(1, "rgba(255,170,100,0)");
    g.fillStyle = grd; g.fillRect(0, 0, W, W);
    const t = texture(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** 2.27 · De noche: halo cálido alrededor de la ampolleta de un farol. */
export function lampHalo(parent, x, y, z, { size = 2.6, opacity = 0.8 } = {}) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: lampHaloTexture(), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  s.scale.set(size, size, 1);
  s.position.set(x, y, z);
  s.renderOrder = 3;
  parent.add(s);
  return s;
}

/** Cuánto encendidos están los faroles según el cielo (0 de día … 1 de noche). */
export function lampLevel(sky) {
  return THREE.MathUtils.clamp((0.5 - sky.day) / 0.35, 0, 1);
}

/**
 * 2.27 · Luz de luna y resplandor de la ciudad para la luz hemisférica y la
 * direccional (que de día es el sol). De noche la escena ya no queda negra:
 * el cielo da una luz azulada suave, el piso devuelve el anaranjado de los
 * faroles de sodio y la luna marca sombras tenues.
 */
export function nightLight(hemi, sun, sky, k = 1) {
  const n = 1 - sky.day, clear = 1 - 0.6 * sky.cloud;
  hemi.color.setHex(0xcfe4ff).lerp(C(0x7088b8), n);
  hemi.groundColor.setHex(0x4a4238).lerp(C(0x6a4a2c), n);
  hemi.intensity += 0.4 * n * k;
  sun.intensity += 0.55 * n * clear * k;
  if (n > 0.6) sun.color.setHex(0xa8bde6);
}

/**
 * 2.27 · Faroles que iluminan de verdad: unas pocas luces puntuales cálidas
 * que se ponen siempre en los faroles más cercanos a la cámara. Son siempre
 * las mismas luces (solo se mueven), así no se recompilan los materiales.
 */
export class NightLamps extends THREE.Group {
  /** @param {Array<[number, number, number]>} spots  posición (x, y, z) de cada ampolleta, en coordenadas del padre */
  constructor(spots, { count = LOW_END ? 4 : 8, intensity = 55, distance = 22 } = {}) {
    super();
    this.spots = spots;
    this.power = intensity;
    this.level = 0;
    this.lights = [];
    for (let i = 0; i < Math.min(count, spots.length); i++) {
      const l = new THREE.PointLight(0xffc98a, 0, distance, 2);
      l.castShadow = false;
      this.lights.push(l);
      this.add(l);
    }
    this.last = { x: Infinity, z: Infinity };
    this.name = "nightLamps";
  }

  /** Enciende (0..1) los faroles. */
  setLevel(k) {
    this.level = k;
    for (const l of this.lights) l.intensity = this.power * k;
  }

  /** Pone las luces en los faroles más cercanos a (x, z). */
  follow(x, z) {
    if (!this.lights.length || Math.hypot(x - this.last.x, z - this.last.z) < 2) return;
    this.last.x = x; this.last.z = z;
    const near = this.spots
      .map(p => [(p[0] - x) ** 2 + (p[2] - z) ** 2, p])
      .sort((a, b) => a[0] - b[0]);
    this.lights.forEach((l, i) => { const p = near[i][1]; l.position.set(p[0], p[1] - 0.35, p[2]); });
  }
}

/* ==========================================================================
   Entorno para reflejos (autos, vidrios y la calzada mojada)
   ========================================================================== */

/**
 * Mapa de entorno hecho con el mismo cielo: los autos, los vidrios y el
 * piso mojado reflejan el cielo de la hora (no un cuarto gris).
 */
export function skyEnvironment(renderer, dome) {
  const pm = new THREE.PMREMGenerator(renderer);
  const sc = new THREE.Scene();
  const d = new SkyDome();
  d.material.uniforms = THREE.UniformsUtils.clone(dome.material.uniforms);
  d.material.uniforms.uOpacity.value = 1;
  // En el mapa de entorno el cielo se dibuja como una esfera común (el truco del infinito no sirve en la cámara cúbica)
  d.material.vertexShader = "varying vec3 vDir;\nvoid main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position * 50.0, 1.0); }";
  d.material.needsUpdate = true;
  sc.add(d);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 24), new THREE.MeshBasicMaterial({ color: dome.material.uniforms.uGround.value.clone().multiplyScalar(0.55) }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -2;
  sc.add(ground);
  const rt = pm.fromScene(sc, 0.02, 0.1, 200);
  pm.dispose();
  d.geometry.dispose(); d.material.dispose(); ground.geometry.dispose(); ground.material.dispose();
  return rt.texture;
}
