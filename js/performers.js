/* ==========================================================================
   MetroSim — performers.js
   Comerciantes ambulantes y músicos del Metro de Santiago.

   En las ESTACIONES (se ven en todos los modos, también desde la cabina):
     · músico en el andén: entre dos columnas, junto al muro, con su guitarra,
       acordeón o charango, el estuche abierto con monedas y un parlante.
       Toca de verdad (se oye más fuerte al acercarse), cambia de tema y
       descansa entre canciones. El pasajero puede darle una moneda (E).
     · comerciante en la mezanina: extiende su paño en la zona no pagada con
       la mercadería ordenada y un cartel de precios. Se le puede comprar (E).
       De vez en cuando llegan los guardias: enrolla el paño y se va a la
       calle; vuelve unos minutos después.

   En los COCHES (encounters.js usa dressMusician/dressVendor y MusicBox):
   el vendedor entra desde el coche vecino con su caja de mercadería y
   recorre el pasillo; el músico se planta junto a una puerta y toca.

   Los personajes son viajeros de people.js (mismo esqueleto y dibujo) con
   estado "performer": nadie los sube a un tren ni los cuenta en la fila.
   Sus instrumentos y paños son mallas comunes colgadas del esqueleto.
   ========================================================================== */

import * as THREE from "three";
import { CONFIG } from "./config.js";
import { PLATFORM_COLUMNS, isArrivalOnly } from "./stationLayout.js";
import { clamp } from "./utils.js";

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const S = CONFIG.station, MZ = CONFIG.mezzanine, EXIT = CONFIG.exit;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Probabilidad de que una estación dibujada tenga músico / comerciante. */
const MUSICIAN_SHARE = 0.55, VENDOR_SHARE = 0.6;


/* ==========================================================================
   Música: estilos y secuenciador con Web Audio
   ========================================================================== */

/** Escalas (semitonos sobre la tónica). */
const MAJOR = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16];
const MINOR = [0, 2, 3, 5, 7, 8, 10, 12, 14, 15];
const PENTA = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];

/**
 * Estilos: tónica (Hz), paso (s), escala, melodía (grados; −1 silencio),
 * bajo (grado por compás de `bar` pasos) y acordes que se rasguean.
 */
export const STYLES = {
  cueca: {
    name: "una cueca", root: 392, step: 0.19, bar: 6, scale: MAJOR,
    melody: [4, 4, 5, 4, 2, 0, 1, 1, 2, 1, -1, 6, 3, 3, 4, 3, 1, 6, 4, -1, 2, 0, -1, -1],
    bass: [0, 4, 4, 0], strum: [0, 3],
  },
  bolero: {
    name: "un bolero", root: 220, step: 0.31, bar: 8, scale: MINOR,
    melody: [4, -1, 3, 2, 3, -1, 4, -1, 5, -1, 4, 3, 2, -1, -1, -1, 1, -1, 2, 3, 4, -1, 2, -1, 0, -1, -1, -1, -1, -1, -1, -1],
    bass: [0, 3, 4, 0], strum: [0, 4],
  },
  cumbia: {
    name: "una cumbia", root: 293.7, step: 0.165, bar: 8, scale: MINOR,
    melody: [0, -1, 2, 4, -1, 4, 3, 2, 1, -1, 3, 5, -1, 5, 4, 3, 2, -1, 4, 6, -1, 5, 4, 3, 2, 1, 0, -1, 0, -1, -1, -1],
    bass: [0, 4, 3, 4], strum: [2, 6], guiro: true,
  },
  vals: {
    name: "un vals peruano", root: 261.6, step: 0.2, bar: 6, scale: MAJOR,
    melody: [2, -1, 4, 5, 4, 2, 1, -1, 3, 4, 3, 1, 0, -1, 2, 4, 6, 7, 6, -1, 4, -1, -1, -1],
    bass: [0, 4, 3, 0], strum: [2, 4],
  },
  andina: {
    name: "música andina", root: 329.6, step: 0.16, bar: 8, scale: PENTA,
    melody: [4, 4, 3, 3, 2, 2, 1, 0, 1, 1, 2, 3, 4, -1, 4, -1, 5, 5, 4, 4, 3, 2, 1, 1, 0, 0, 1, 2, 0, -1, -1, -1],
    bass: [0, 2, 3, 0], strum: [0, 4], tremolo: true,
  },
};

/** Instrumentos: timbre de la melodía, qué estilos toca y cómo se llama. */
export const INSTRUMENTS = {
  guitarra: { label: "guitarra", icon: "🎸", styles: ["cueca", "bolero", "vals"], wave: "triangle", dur: 0.42, gain: 1, octave: 1 },
  acordeon: { label: "acordeón", icon: "🪗", styles: ["cumbia", "vals", "cueca"], wave: "sawtooth", dur: 0, gain: 0.32, octave: 1, attack: 0.03 },
  charango: { label: "charango", icon: "🪕", styles: ["andina", "cueca"], wave: "triangle", dur: 0.16, gain: 0.9, octave: 2 },
};

/**
 * Secuenciador de un músico: programa las notas un poco por delante del
 * reloj de audio. play(vol) en cada fotograma; con vol 0 sigue llevando el
 * compás en silencio (así la canción no se reinicia al alejarse).
 */
export class MusicBox {
  constructor(audio, instrument, style) {
    this.audio = audio;
    this.inst = INSTRUMENTS[instrument];
    this.setStyle(style);
  }

  setStyle(style) { this.style = STYLES[style]; this.i = 0; this.next = 0; }

  play(vol) {
    const a = this.audio, ctx = a?.ctx;
    if (!ctx || !this.style) return;
    const now = ctx.currentTime, st = this.style;
    if (this.next < now - 0.4) this.next = now + 0.05;          // estuvo en pausa (pestaña oculta, sin música)
    while (this.next < now + 0.25) {
      if (vol > 0.01 && !a.muted) this.note(this.i, this.next - now, vol);
      this.i++;
      this.next += st.step;
    }
  }

  note(i, at, vol) {
    const a = this.audio, st = this.style, inst = this.inst;
    const freq = (deg, oct = 0) => {
      const n = st.scale.length, d = ((deg % n) + n) % n;
      return st.root * 2 ** ((st.scale[d] + 12 * (Math.floor(deg / n) + oct)) / 12);
    };
    const len = st.melody.length, step = i % len, inBar = step % st.bar;
    const g = 0.03 * vol * inst.gain;
    const deg = st.melody[step];
    if (deg >= 0) {
      const f = freq(deg, inst.octave - 1);
      const dur = inst.dur || st.step * 0.95;
      a.tone(f, { start: at, duration: dur, gain: g, wave: inst.wave, attack: inst.attack ?? 0.004 });
      if (st.tremolo) a.tone(f, { start: at + st.step / 2, duration: dur * 0.8, gain: g * 0.7, wave: inst.wave });
    }
    // Bajo al inicio de cada compás y rasgueo (tres cuerdas, apenas desfasadas)
    const chord = st.bass[Math.floor(step / st.bar) % st.bass.length];
    if (inBar === 0) a.tone(freq(chord, -2), { start: at, duration: st.step * 2.2, gain: g * 1.4, wave: "sine", attack: 0.006 });
    if (st.strum.includes(inBar)) {
      [0, 2, 4].forEach((k, j) => a.tone(freq(chord + k, -1), { start: at + j * 0.014, duration: 0.3, gain: g * 0.45, wave: "triangle", attack: 0.003 }));
    }
    if (st.guiro) a.burst({ start: at, duration: inBar % 2 ? 0.05 : 0.11, gain: 0.012 * vol, type: "highpass", freq: 3800, q: 0.9, attack: 0.01 });
  }
}

/** Volumen de un músico según la distancia (m) y si está en otro nivel de la estación. */
export function musicVolume(d, dy = 0) {
  const v = clamp(1 - d / 24, 0, 1) ** 1.6;
  return dy > 2.5 ? v * 0.25 : v;
}


/* ==========================================================================
   Utilería: instrumentos, cajas de mercadería, paños y carteles
   ========================================================================== */

const geoCache = new Map(), matCache = new Map();
const box = (x, y, z) => { const k = `b${x},${y},${z}`; if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(x, y, z)); return geoCache.get(k); };
const cyl = (r, h, n = 18) => { const k = `c${r},${h},${n}`; if (!geoCache.has(k)) geoCache.set(k, new THREE.CylinderGeometry(r, r, h, n)); return geoCache.get(k); };
const mat = (color, o = {}) => {
  const k = color + JSON.stringify(o);
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...o }));
  return matCache.get(k);
};
const mesh = (parent, geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); parent.add(o); return o; };

/** Cartel de cartón escrito a mano. */
const signCache = new Map();
function signMaterial(lines) {
  const key = lines.join("|");
  if (signCache.has(key)) return signCache.get(key);
  const c = document.createElement("canvas");
  c.width = 256; c.height = 160;
  const g = c.getContext("2d");
  g.fillStyle = "#c9a36b"; g.fillRect(0, 0, 256, 160);
  g.fillStyle = "#b48c55"; for (let i = 0; i < 6; i++) g.fillRect(0, 20 + i * 24, 256, 2);
  g.fillStyle = "#1b1a3a";
  g.textAlign = "center"; g.textBaseline = "middle";
  const size = lines.length > 2 ? 34 : 44;
  g.font = `bold ${size}px "Comic Sans MS", "Marker Felt", system-ui, sans-serif`;
  lines.forEach((t, i) => g.fillText(t, 128, 80 + (i - (lines.length - 1) / 2) * size * 1.1));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
  signCache.set(key, m);
  return m;
}

/** Tela de colores tipo aguayo para el paño del comerciante. */
let blanketMat = null;
function blanketMaterial() {
  if (blanketMat) return blanketMat;
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const g = c.getContext("2d");
  const cols = ["#b3202a", "#e0a419", "#1f6f5c", "#5b2a86", "#d9572b", "#1d3f8a"];
  for (let y = 0; y < 128; y += 8) { g.fillStyle = cols[(y / 8) % cols.length]; g.fillRect(0, y, 128, 8); }
  g.fillStyle = "#f2e6c8";
  for (let y = 4; y < 128; y += 32) for (let x = 0; x < 128; x += 16) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + 8, y + 4); g.lineTo(x, y + 8); g.fill(); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return blanketMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
}

/** Medidas útiles del esqueleto (people.js · createSkeleton). */
function frame(p) {
  const legLen = p.mesh.legLen, h = legLen / 0.84, torsoH = 0.58 * h;
  return { legLen, torsoH, chest: legLen + torsoH * 0.62, waist: legLen + 0.12 };
}

/** Guitarra o charango (mástil hacia +X local), colgado al frente del cuerpo. */
function buildGuitar(scale = 1) {
  const g = new THREE.Group();
  const wood = mat(scale < 1 ? 0x8a4b1f : 0xb8742c), dark = mat(0x2a1a10);
  const lower = mesh(g, cyl(0.17, 0.09), wood, 0, 0, 0); lower.rotation.x = Math.PI / 2;
  const upper = mesh(g, cyl(0.13, 0.09), wood, 0.2, 0, 0); upper.rotation.x = Math.PI / 2;
  const hole = mesh(g, cyl(0.045, 0.092, 12), dark, 0.11, 0, 0.001); hole.rotation.x = Math.PI / 2;
  mesh(g, box(0.48, 0.05, 0.03), dark, 0.53, 0, 0.03);
  mesh(g, box(0.13, 0.07, 0.035), dark, 0.82, 0, 0.03);
  mesh(g, box(0.035, 0.12, 0.02), dark, -0.08, 0, 0.05);                   // puente
  g.scale.setScalar(scale);
  return g;
}

/** Acordeón: dos tapas y un fuelle a rayas que se abre y cierra. */
function buildAccordion() {
  const g = new THREE.Group();
  const red = mat(0x9c1b26, { roughness: 0.4 }), white = mat(0xeeeeee, { roughness: 0.5 }), black = mat(0x111111);
  [-1, 1].forEach(s => mesh(g, box(0.09, 0.34, 0.2), red, s * 0.2, 0, 0));
  mesh(g, box(0.02, 0.3, 0.04), white, -0.255, 0, 0.06);                  // teclado
  const bellows = new THREE.Group();
  g.add(bellows);
  for (let i = 0; i < 7; i++) mesh(bellows, box(0.042, 0.32, 0.19), i % 2 ? black : white, -0.13 + i * 0.044, 0, 0);
  g.userData.bellows = bellows;
  return g;
}

/** Caja de cartón del vendedor de los coches, colgada del cuello, con su mercadería. */
function buildTray() {
  const g = new THREE.Group();
  mesh(g, box(0.46, 0.06, 0.3), mat(0xa77b45), 0, 0, 0);
  const items = [0x5b2a17, 0xe8c547, 0xd23a3a, 0x2a7bd6, 0xf2f2f2, 0x3a8f3a];
  for (let i = 0; i < 6; i++) mesh(g, box(0.12, 0.05, 0.08), mat(items[i]), -0.15 + (i % 3) * 0.15, 0.05, -0.07 + Math.floor(i / 3) * 0.14);
  const sign = mesh(g, new THREE.PlaneGeometry(0.4, 0.22), signMaterial(["3 x $1.000"]), 0, 0.08, 0.16);
  sign.rotation.x = -0.25;
  return g;
}

/** Bulto con el paño enrollado (a la espalda, cuando se va). */
function buildBundle() {
  const g = new THREE.Group();
  const roll = mesh(g, cyl(0.13, 0.7, 12), blanketMaterial(), 0, 0, 0);
  roll.rotation.z = Math.PI / 2;
  return g;
}

/** Postura de los brazos (rotación x y z) que se aplica después de la animación de people.js. */
function setArm(arm, x, z = 0) { arm.rotation.x = x; arm.rotation.z = z; }

/**
 * Viste a un viajero de músico. Devuelve la utilería (para quitarla) y deja
 * p.overlay, que people.js llama tras animar: rasgueo, fuelle o punteo.
 */
export function dressMusician(p, instrument) {
  const m = p.mesh, f = frame(p);
  let prop;
  if (instrument === "acordeon") {
    prop = buildAccordion();
    prop.position.set(0, f.chest - 0.05, 0.23);
  } else {
    prop = buildGuitar(instrument === "charango" ? 0.62 : 1);
    if (instrument === "charango") { prop.position.set(-0.02, f.chest - 0.04, 0.17); prop.rotation.z = 0.35; }
    else { prop.position.set(-0.06, f.waist + 0.1, 0.17); prop.rotation.z = 0.42; }
  }
  m.body.add(prop);
  p.performer = { ...(p.performer || {}), instrument, prop, playing: true };
  p.overlay = (sk, t) => {
    const play = p.performer.playing && p.pose !== "walk";
    if (instrument === "acordeon") {
      const pump = play ? Math.sin(t * 2.6) : 0;
      prop.userData.bellows.scale.x = 1 + pump * 0.3;
      setArm(sk.armL, -0.95, 0.35 + pump * 0.12);
      setArm(sk.armR, -0.95, -0.35 - pump * 0.12);
    } else {
      // armR (+X) sostiene el mástil; armL (−X) rasguea sobre la boca
      setArm(sk.armR, instrument === "charango" ? -1.0 : -0.85, 0.08);
      setArm(sk.armL, -0.7 + (play ? Math.sin(t * (instrument === "charango" ? 22 : 13)) * 0.09 : 0), 0.4);
    }
    if (play) sk.body.rotation.z = Math.sin(t * 3.1) * 0.03;               // se mece con la música
  };
  return prop;
}

/** Vendedor de los coches: caja al frente, sujeta con las dos manos. */
export function dressVendor(p) {
  const m = p.mesh, f = frame(p);
  const prop = buildTray();
  prop.position.set(0, f.waist + 0.12, 0.3);
  m.body.add(prop);
  p.performer = { ...(p.performer || {}), prop };
  p.overlay = (sk) => { setArm(sk.armL, -0.62, -0.12); setArm(sk.armR, -0.62, 0.12); };
  return prop;
}

/** Colores de ropa: el guardia de seguridad de Metro va de azul oscuro con chaleco reflectante. */
function uniform(p) {
  const navy = new THREE.Color(0x1a2236), vest = new THREE.Color(0xc7e83a);
  for (const part of p.mesh.parts) if (part.kind === "box") part.color = navy;
  const torso = p.mesh.parts.filter(q => q.kind === "box")[4];                // tras las 4 piernas: el torso
  if (torso) torso.color = vest;
  for (const part of p.mesh.parts) if (part.kind === "hair") part.color = new THREE.Color(0x101010);
}


/* ==========================================================================
   Sitios de cada estación
   ========================================================================== */

/** Lugar del músico en un andén: junto al muro, a mitad de camino entre una columna y un banco. */
function musicianSpot(st) {
  const sides = [1, -1].filter(s => !isArrivalOnly(st, s));
  if (!sides.length) return null;
  const side = pick(sides);
  const offs = PLATFORM_COLUMNS.filter(o => o - 3 > S.platformZ0 + 6 && o - 3 < MZ.stairZ0 - 4);
  if (!offs.length) return null;
  const z = st.z + pick(offs) - 3;
  return { side, pos: V(side * 7.05, S.platformTop, z), yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2 };
}

/** Paño del comerciante: zona no pagada de la mezanina, junto al muro +X (lejos de la boletería). */
const VENDOR_Z = 47.2;
const vendorSpot = (st) => ({ pos: V(7.75, MZ.y, st.z + VENDOR_Z), blanket: V(6.75, MZ.y, st.z + VENDOR_Z), yaw: -Math.PI / 2 });

/** Mercadería del paño (estación). */
export const STALL_ITEMS = [
  { name: "Maní confitado", price: 500, bag: "Maní confitado" },
  { name: "Chocolates (3 por $1.000)", price: 1000, bag: "Chocolates de un comerciante" },
  { name: "Audífonos con cable", price: 2000, bag: "Audífonos" },
  { name: "Cargador de celular", price: 2500, bag: "Cargador de celular" },
  { name: "Calcetines (3 pares $2.000)", price: 2000, bag: "Calcetines" },
  { name: "Paraguas", price: 3000, bag: "Paraguas" },
];
const STALL_COLORS = [0x8a5a2b, 0x5b2a17, 0x1b1b1b, 0xf2f2f2, 0x6b4f8a, 0x23344d];

/** Paño extendido en el suelo con la mercadería en filas y el cartel de precios. */
function buildStall(at) {
  const g = new THREE.Group();
  g.position.copy(at);
  mesh(g, box(1.05, 0.012, 1.7), blanketMaterial(), 0, 0.006, 0);
  STALL_ITEMS.forEach((_, i) => {
    const col = mat(STALL_COLORS[i]);
    for (let k = 0; k < 3; k++) {
      const z = -0.62 + i * 0.25, x = -0.3 + k * 0.28;
      mesh(g, box(0.18, 0.05 + (i % 2) * 0.03, 0.14), col, x, 0.04, z);
    }
  });
  const sign = mesh(g, new THREE.PlaneGeometry(0.5, 0.31), signMaterial(["Maní $500", "3 x $1.000", "Cargador $2.500"]), 0.48, 0.22, 0);
  sign.rotation.set(-0.35, -Math.PI / 2, 0, "YXZ");
  return g;
}

/** Estuche abierto con monedas y parlante del músico. */
function buildBusk(site) {
  const g = new THREE.Group();
  const { pos, side } = site.spot;
  g.position.copy(pos);
  const toTrack = -side;                                              // hacia las vías
  const caseG = new THREE.Group();
  caseG.position.set(toTrack * 0.75, 0, 0.35);
  caseG.rotation.y = 0.2;
  g.add(caseG);
  mesh(caseG, box(0.42, 0.08, 1.0), mat(0x151515), 0, 0.04, 0);
  mesh(caseG, box(0.36, 0.02, 0.92), mat(0x7a1020, { roughness: 1 }), 0, 0.075, 0);
  const coin = mat(0xd9b44a, { metalness: 0.6, roughness: 0.35 });
  site.coins = [];
  for (let i = 0; i < 9; i++) {
    const c = mesh(caseG, cyl(0.014, 0.004, 10), coin, rand(-0.13, 0.13), 0.088, rand(-0.38, 0.38));
    c.visible = i < 5;
    site.coins.push(c);
  }
  const amp = mesh(g, box(0.3, 0.38, 0.22), mat(0x202020), toTrack * -0.05, 0.19, -0.65);
  const grille = mesh(amp, cyl(0.09, 0.01, 16), mat(0x444444, { metalness: 0.4 }), toTrack * 0.112, 0.02, 0);
  grille.rotation.z = Math.PI / 2;
  const sign = mesh(g, new THREE.PlaneGeometry(0.34, 0.22), signMaterial(["¡Gracias", "por su aporte!"]), toTrack * 0.75, 0.16, -0.32);
  sign.rotation.set(-0.5, toTrack > 0 ? Math.PI / 2 : -Math.PI / 2, 0, "YXZ");
  return g;
}

/** Recorrido de la mezanina (zona no pagada) a la calle, y al revés. */
function toStreet(st) {
  const x = rand(-0.7, 0.7);
  return [V(rand(-1, 1), MZ.y, st.z + MZ.z1 - 0.3), V(x, MZ.y, st.z + EXIT.corridorZ1 - 0.3), V(x, MZ.y + EXIT.rise, st.z + EXIT.flightZ1 + 0.5)];
}
const fromStreet = (st) => toStreet(st).reverse();


export class PerformerSystem {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {import("./people.js").PeopleSystem} o.people
   * @param {object} o.audio
   * @param {(text:string, level?:string, ms?:number) => void} [o.say]  aviso (solo modo Pasajero)
   */
  constructor(o) {
    Object.assign(this, o);
    this.sites = new Map();                         // índice de estación → { musician, vendor }
  }

  /* ----- Consultas ----- */
  alive(p) { return !!p && p.state !== "gone" && this.people.people.includes(p); }

  /**
   * Músico o comerciante al alcance del pasajero (en la estación, mismo nivel).
   * @returns {{ kind:"musician"|"vendor", site:object, who:object }|null}
   */
  nearest(pos) {
    let best = null, bestD = Infinity;
    for (const s of this.sites.values()) {
      const m = s.musician;
      if (m?.ready && this.alive(m.p) && Math.abs(m.p.root.position.y - pos.y) < 1) {
        const d = Math.hypot(m.p.root.position.x - pos.x, m.p.root.position.z - pos.z);
        if (d < 2.8 && d < bestD) { bestD = d; best = { kind: "musician", site: s, who: m }; }
      }
      const v = s.vendor;
      if (v?.ready && this.alive(v.p) && Math.abs(MZ.y - pos.y) < 1) {
        const d = Math.hypot(v.spot.blanket.x - pos.x, v.spot.blanket.z - pos.z);
        if (d < 2.4 && d < bestD) { bestD = d; best = { kind: "vendor", site: s, who: v }; }
      }
    }
    return best;
  }

  /* ----- Paso por fotograma ----- */
  /** @param {THREE.Vector3} listener  dónde está la cámara (para el volumen de la música) */
  update(dt, listener) {
    for (const ss of this.people.stations) {
      const i = ss.st.index;
      let site = this.sites.get(i);
      if (!ss.materialized) {
        if (site) this.clear(site);
        continue;
      }
      if (!site) this.sites.set(i, site = this.open(ss.st));
      this.tickMusician(site, dt, listener);
      this.tickVendor(site, dt, listener);
    }
  }

  /** La estación aparece cerca de la cámara: ¿hay músico? ¿comerciante? */
  open(st) {
    const site = { st, musician: null, vendor: null, guard: null };
    if (Math.random() < MUSICIAN_SHARE) {
      const spot = musicianSpot(st);
      if (spot) this.spawnMusician(site, spot);
    }
    if (Math.random() < VENDOR_SHARE) this.spawnVendor(site, true);
    else site.vendorBack = rand(60, 240);           // quizás llegue uno más tarde
    return site;
  }

  /** La estación quedó lejos: people.js ya quitó a las personas; aquí la utilería del suelo. */
  clear(site) {
    site.musician?.floor.removeFromParent();
    site.vendor?.stall?.removeFromParent();
    this.sites.delete(site.st.index);
  }

  spawnMusician(site, spot) {
    const p = this.people.newPerson(site.st, spot.side);
    p.state = "performer";
    p.root.position.copy(spot.pos);
    p.root.rotation.y = p.targetYaw = spot.yaw;
    const instrument = pick(Object.keys(INSTRUMENTS));
    dressMusician(p, instrument);
    const inst = INSTRUMENTS[instrument];
    site.spot = spot;
    const m = site.musician = {
      p, spot, instrument, inst, ready: true, paid: false,
      style: pick(inst.styles), box: null, songT: rand(50, 110), restT: 0,
    };
    m.box = new MusicBox(this.audio, instrument, m.style);
    m.floor = buildBusk(site);
    this.scene.add(m.floor);
  }

  tickMusician(site, dt, listener) {
    const m = site.musician;
    if (!m || !this.alive(m.p)) return;
    // Canciones de un minuto o dos, con una pausa corta entre ellas (y otro tema)
    if (m.restT > 0) {
      m.restT -= dt;
      if (m.restT <= 0) { m.style = pick(m.inst.styles); m.box.setStyle(m.style); m.p.performer.playing = true; m.songT = rand(50, 110); }
    } else {
      m.songT -= dt;
      if (m.songT <= 0) { m.p.performer.playing = false; m.restT = rand(6, 14); }
    }
    if (!m.p.performer.playing) return;
    const q = m.p.root.position;
    const d = Math.hypot(q.x - listener.x, q.z - listener.z);
    m.box.play(d < 30 ? musicVolume(d, Math.abs(q.y - listener.y)) : 0);
  }

  /** Comerciante: llega desde la calle (o ya está instalado) y extiende su paño. */
  spawnVendor(site, instant) {
    const st = site.st, spot = vendorSpot(st);
    const p = this.people.newPerson(st, 1);
    p.state = "performer";
    const v = site.vendor = { p, spot, ready: false, stall: null, guardT: rand(120, 420) };
    const setUp = () => {
      p.root.position.copy(spot.pos);
      p.root.rotation.y = p.targetYaw = spot.yaw;
      p.pose = "stand";
      v.stall = buildStall(spot.blanket);
      this.scene.add(v.stall);
      v.ready = true;
      v.bundle?.removeFromParent();
      p.overlay = null;
    };
    if (instant) return setUp();
    const path = fromStreet(st);
    p.root.position.copy(path[0]);
    v.bundle = buildBundle();
    v.bundle.position.set(0, frame(p).chest, -0.22);
    p.mesh.body.add(v.bundle);
    this.people.walk(p, [...path.slice(1), spot.pos], setUp);
  }

  tickVendor(site, dt, listener) {
    const v = site.vendor;
    if (!v) {
      if (site.vendorBack !== undefined && (site.vendorBack -= dt) <= 0) { site.vendorBack = undefined; this.spawnVendor(site, false); }
      return;
    }
    if (!this.alive(v.p)) {
      // Se fue a la calle (o lo quitó people.js): vuelve en unos minutos
      v.stall?.removeFromParent();
      site.vendor = null;
      site.vendorBack = rand(150, 330);
      return;
    }
    if (!v.ready || v.leaving) return;
    // Pregona de vez en cuando si el jugador está cerca
    const q = v.p.root.position, near = Math.hypot(q.x - listener.x, q.z - listener.z) < 9 && Math.abs(q.y - listener.y) < 1.5;
    if (near && !v.talking) {
      v.shoutT = (v.shoutT ?? rand(3, 8)) - dt;
      if (v.shoutT <= 0) { v.shoutT = rand(14, 26); this.audio?.shout?.(pick(STALL_SHOUTS)); }
    }
    if (v.talking) return;
    v.guardT -= dt;
    if (v.guardT <= 0) this.guards(site, near);
  }

  /** Llegan los guardias: el comerciante enrolla el paño y se va a la calle. */
  guards(site, near) {
    const v = site.vendor, st = site.st;
    v.leaving = true;
    v.ready = false;
    if (near) this.say?.("👮 «¡Ahí vienen los guardias!» · el comerciante enrolla su paño a toda velocidad y se va", "info", 5000);
    // Un guardia de seguridad entra desde los torniquetes y mira la zona
    const gIdx = pick(MZ.gates);
    const guard = this.people.newPerson(st, 1);
    guard.state = "performer";
    uniform(guard);
    guard.root.position.set(gIdx, MZ.y, st.z + MZ.gateZ + 0.9);
    this.people.walk(guard, [V(5.2, MZ.y, st.z + VENDOR_Z - 0.4)], () => {
      guard.targetYaw = Math.PI / 2;
      setTimeout(() => {
        if (!this.alive(guard)) return;
        this.people.walk(guard, toStreet(st), () => this.people.remove(guard));
      }, 9000);
    });
    // Enrolla el paño (2 s) y se va con el bulto a la espalda
    const p = v.p;
    p.pose = "stand";
    setTimeout(() => {
      if (!this.alive(p)) return;
      v.stall?.removeFromParent();
      v.stall = null;
      v.bundle = buildBundle();
      v.bundle.position.set(0, frame(p).chest, -0.22);
      p.mesh.body.add(v.bundle);
      this.people.walk(p, toStreet(st), () => this.people.remove(p));
    }, 1800);
  }

  /* ----- Con el pasajero (encounters.js abre los diálogos) ----- */
  /** Moneda al músico: suma una al estuche. */
  tip(site) {
    const m = site.musician;
    if (!m) return;
    m.paid = true;
    const hidden = site.coins?.filter(c => !c.visible) || [];
    hidden.slice(0, 2).forEach(c => { c.visible = true; });
  }

  /** Pedirle otra canción. */
  request(site) {
    const m = site.musician;
    if (!m) return null;
    const others = m.inst.styles.filter(s => s !== m.style);
    m.style = pick(others.length ? others : m.inst.styles);
    m.box.setStyle(m.style);
    m.p.performer.playing = true;
    m.restT = 0;
    m.songT = rand(60, 110);
    return STYLES[m.style].name;
  }

  destroy() { for (const s of [...this.sites.values()]) this.clear(s); }
}

const STALL_SHOUTS = [
  "¡Maní confitado, quinientos el maní!",
  "¡Cargador, cargador, a dos quinientos!",
  "¡Lleve calcetines, tres pares a dos lucas!",
  "¡Chocolates, tres por mil, aproveche!",
];

